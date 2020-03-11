import { ExecutionResult, DocumentNode } from 'graphql';
import { invariant, InvariantError } from 'ts-invariant';

import { ApolloLink } from '../link/core/ApolloLink';
import { execute } from '../link/core/execute';
import { FetchResult } from '../link/core/types';
import { Cache } from '../cache/core/types/Cache';

import {
  getDefaultValues,
  getOperationDefinition,
  getOperationName,
} from '../utilities/graphql/getFromAST';
import {
  hasDirectives,
  hasClientExports,
} from '../utilities/graphql/directives';
import {
  graphQLResultHasError,
  tryFunctionOrLogError,
} from '../utilities/common/errorHandling';
import { removeConnectionDirectiveFromDocument } from '../utilities/graphql/transform';
import { canUseWeakMap } from '../utilities/common/canUse';
import { isApolloError, ApolloError } from '../errors/ApolloError';
import {
  Observer,
  ObservableSubscription,
  Observable
} from '../utilities/observables/Observable';
import { MutationStore } from '../data/mutations';
import { QueryStore, QueryStoreValue } from '../data/queries';
import {
  QueryOptions,
  WatchQueryOptions,
  SubscriptionOptions,
  MutationOptions,
  ErrorPolicy,
} from './watchQueryOptions';
import { ObservableQuery } from './ObservableQuery';
import { NetworkStatus, isNetworkRequestInFlight } from './networkStatus';
import {
  QueryListener,
  ApolloQueryResult,
  FetchType,
  OperationVariables,
  MutationQueryReducer,
} from './types';
import { LocalState } from './LocalState';
import { asyncMap, multiplex } from '../utilities/observables/observables';
import { isNonEmptyArray } from '../utilities/common/arrays';
import { ApolloCache } from '../cache/core/cache';

const { hasOwnProperty } = Object.prototype;

export interface QueryInfo {
  listeners: Set<QueryListener>;
  invalidated: boolean;
  newData: Cache.DiffResult<any> | null;
  document: DocumentNode | null;
  lastRequestId: number;
  // A map going from queryId to an observer for a query issued by watchQuery. We use
  // these to keep track of queries that are inflight and error on the observers associated
  // with them in case of some destabalizing action (e.g. reset of the Apollo store).
  observableQuery: ObservableQuery<any> | null;
  subscriptions: Set<ObservableSubscription>;
  cancel?: () => void;
}

type QueryWithUpdater = {
  updater: MutationQueryReducer<Object>;
  query: QueryStoreValue;
};

export class QueryManager<TStore> {
  public cache: ApolloCache<TStore>;
  public link: ApolloLink;
  public mutationStore: MutationStore = new MutationStore();
  public queryStore: QueryStore = new QueryStore();
  public readonly assumeImmutableResults: boolean;

  private queryDeduplication: boolean;
  private clientAwareness: Record<string, string> = {};
  private localState: LocalState<TStore>;

  private onBroadcast: () => void;

  private ssrMode: boolean;

  // let's not start at zero to avoid pain with bad checks
  private idCounter = 1;

  // XXX merge with ObservableQuery but that needs to be expanded to support mutations and
  // subscriptions as well
  private queries: Map<string, QueryInfo> = new Map();

  // A map of Promise reject functions for fetchQuery promises that have not
  // yet been resolved, used to keep track of in-flight queries so that we can
  // reject them in case a destabilizing event occurs (e.g. Apollo store reset).
  // The key is in the format of `query:${queryId}` or `fetchRequest:${queryId}`,
  // depending on where the promise's rejection function was created from.
  private fetchQueryRejectFns = new Map<string, Function>();

  constructor({
    cache,
    link,
    queryDeduplication = false,
    onBroadcast = () => undefined,
    ssrMode = false,
    clientAwareness = {},
    localState,
    assumeImmutableResults,
  }: {
    cache: ApolloCache<TStore>;
    link: ApolloLink;
    queryDeduplication?: boolean;
    onBroadcast?: () => void;
    ssrMode?: boolean;
    clientAwareness?: Record<string, string>;
    localState?: LocalState<TStore>;
    assumeImmutableResults?: boolean;
  }) {
    this.cache = cache;
    this.link = link;
    this.queryDeduplication = queryDeduplication;
    this.onBroadcast = onBroadcast;
    this.clientAwareness = clientAwareness;
    this.localState = localState || new LocalState({ cache });
    this.ssrMode = ssrMode;
    this.assumeImmutableResults = !!assumeImmutableResults;
  }

  /**
   * Call this method to terminate any active query processes, making it safe
   * to dispose of this QueryManager instance.
   */
  public stop() {
    this.queries.forEach((_info, queryId) => {
      this.stopQueryNoBroadcast(queryId);
    });

    this.fetchQueryRejectFns.forEach(reject => {
      reject(
        new InvariantError('QueryManager stopped while query was in flight'),
      );
    });
  }

  public async mutate<T>({
    mutation,
    variables,
    optimisticResponse,
    updateQueries: updateQueriesByName,
    refetchQueries = [],
    awaitRefetchQueries = false,
    update: updateWithProxyFn,
    errorPolicy = 'none',
    fetchPolicy,
    context = {},
  }: MutationOptions): Promise<FetchResult<T>> {
    invariant(
      mutation,
      'mutation option is required. You must specify your GraphQL document in the mutation option.',
    );

    invariant(
      !fetchPolicy || fetchPolicy === 'no-cache',
      "Mutations only support a 'no-cache' fetchPolicy. If you don't want to disable the cache, remove your fetchPolicy setting to proceed with the default mutation behavior."
    );

    const mutationId = this.generateQueryId();
    mutation = this.transform(mutation).document;

    this.setQuery(mutationId, () => ({ document: mutation }));

    variables = this.getVariables(mutation, variables);

    if (this.transform(mutation).hasClientExports) {
      variables = await this.localState.addExportedVariables(mutation, variables, context);
    }

    // Create a map of update queries by id to the query instead of by name.
    const generateUpdateQueriesInfo: () => {
      [queryId: string]: QueryWithUpdater;
    } = () => {
      const ret: { [queryId: string]: QueryWithUpdater } = {};

      if (updateQueriesByName) {
        this.queries.forEach(({ observableQuery }, queryId) => {
          if (observableQuery) {
            const { queryName } = observableQuery;
            if (
              queryName &&
              hasOwnProperty.call(updateQueriesByName, queryName)
            ) {
              ret[queryId] = {
                updater: updateQueriesByName[queryName],
                query: this.queryStore.get(queryId),
              };
            }
          }
        });
      }

      return ret;
    };

    this.mutationStore.initMutation(
      mutationId,
      mutation,
      variables,
    );

    if (optimisticResponse) {
      const optimistic = typeof optimisticResponse === 'function'
        ? optimisticResponse(variables)
        : optimisticResponse;

      this.cache.recordOptimisticTransaction(cache => {
        markMutationResult({
          mutationId: mutationId,
          result: { data: optimistic },
          document: mutation,
          variables: variables,
          queryUpdatersById: generateUpdateQueriesInfo(),
          update: updateWithProxyFn,
        }, cache);
      }, mutationId);
    }

    this.broadcastQueries();

    const self = this;

    return new Promise((resolve, reject) => {
      let storeResult: FetchResult<T> | null;
      let error: ApolloError;

      self.getObservableFromLink(
        mutation,
        {
          ...context,
          optimisticResponse,
        },
        variables,
        false,
      ).subscribe({
        next(result: ExecutionResult) {
          if (graphQLResultHasError(result) && errorPolicy === 'none') {
            error = new ApolloError({
              graphQLErrors: result.errors,
            });
            return;
          }

          self.mutationStore.markMutationResult(mutationId);

          if (fetchPolicy !== 'no-cache') {
            markMutationResult({
              mutationId,
              result,
              document: mutation,
              variables,
              queryUpdatersById: generateUpdateQueriesInfo(),
              update: updateWithProxyFn,
            }, self.cache);
          }

          storeResult = result as FetchResult<T>;
        },

        error(err: Error) {
          self.mutationStore.markMutationError(mutationId, err);
          if (optimisticResponse) {
            self.cache.removeOptimistic(mutationId);
          }
          self.broadcastQueries();
          self.setQuery(mutationId, () => ({ document: null }));
          reject(
            new ApolloError({
              networkError: err,
            }),
          );
        },

        complete() {
          if (error) {
            self.mutationStore.markMutationError(mutationId, error);
          }

          if (optimisticResponse) {
            self.cache.removeOptimistic(mutationId);
          }

          self.broadcastQueries();

          if (error) {
            reject(error);
            return;
          }

          // allow for conditional refetches
          // XXX do we want to make this the only API one day?
          if (typeof refetchQueries === 'function') {
            refetchQueries = refetchQueries(storeResult as ExecutionResult);
          }

          const refetchQueryPromises: Promise<
            ApolloQueryResult<any>[] | ApolloQueryResult<{}>
          >[] = [];

          if (isNonEmptyArray(refetchQueries)) {
            refetchQueries.forEach(refetchQuery => {
              if (typeof refetchQuery === 'string') {
                self.queries.forEach(({ observableQuery }) => {
                  if (
                    observableQuery &&
                    observableQuery.queryName === refetchQuery
                  ) {
                    refetchQueryPromises.push(observableQuery.refetch());
                  }
                });
              } else {
                const queryOptions: QueryOptions = {
                  query: refetchQuery.query,
                  variables: refetchQuery.variables,
                  fetchPolicy: 'network-only',
                };

                if (refetchQuery.context) {
                  queryOptions.context = refetchQuery.context;
                }

                refetchQueryPromises.push(self.query(queryOptions));
              }
            });
          }

          Promise.all(
            awaitRefetchQueries ? refetchQueryPromises : [],
          ).then(() => {
            self.setQuery(mutationId, () => ({ document: null }));

            if (
              errorPolicy === 'ignore' &&
              storeResult &&
              graphQLResultHasError(storeResult)
            ) {
              delete storeResult.errors;
            }

            resolve(storeResult!);
          });
        },
      });
    });
  }

  public async fetchQuery<T>(
    queryId: string,
    options: WatchQueryOptions,
    fetchType?: FetchType,
    // This allows us to track if this is a query spawned by a `fetchMore`
    // call for another query. We need this data to compute the `fetchMore`
    // network status for the query this is fetching for.
    fetchMoreForQueryId?: string,
  ): Promise<FetchResult<T>> {
    const {
      metadata = null,
      fetchPolicy = 'cache-first', // cache-first is the default fetch policy.
      context = {},
    } = options;

    const query = this.transform(options.query).document;

    let variables = this.getVariables(query, options.variables);

    if (this.transform(query).hasClientExports) {
      variables = await this.localState.addExportedVariables(query, variables, context);
    }

    options = { ...options, variables };

    let storeResult: any;
    const isNetworkOnly =
      fetchPolicy === 'network-only' || fetchPolicy === 'no-cache';
    let needToFetch = isNetworkOnly;

    // Unless we are completely skipping the cache, we want to diff the query
    // against the cache before we fetch it from the network interface.
    if (!isNetworkOnly) {
      const { complete, result } = this.cache.diff({
        query,
        variables,
        returnPartialData: true,
        optimistic: false,
      });

      // If we're in here, only fetch if we have missing fields
      needToFetch = !complete || fetchPolicy === 'cache-and-network';
      storeResult = result;
    }

    let shouldFetch =
      needToFetch && fetchPolicy !== 'cache-only' && fetchPolicy !== 'standby';

    // we need to check to see if this is an operation that uses the @live directive
    if (hasDirectives(['live'], query)) shouldFetch = true;

    const requestId = this.idCounter++;

    // set up a watcher to listen to cache updates
    const cancel = fetchPolicy !== 'no-cache'
      ? this.updateQueryWatch(queryId, query, options)
      : undefined;

    // Initialize query in store with unique requestId
    this.setQuery(queryId, () => ({
      document: query,
      lastRequestId: requestId,
      invalidated: true,
      cancel,
    }));

    this.invalidate(fetchMoreForQueryId);

    this.queryStore.initQuery({
      queryId,
      document: query,
      storePreviousVariables: shouldFetch,
      variables,
      isPoll: fetchType === FetchType.poll,
      isRefetch: fetchType === FetchType.refetch,
      metadata,
      fetchMoreForQueryId,
    });

    if (shouldFetch) {
      this.broadcastQueries();

      const networkResult = this.fetchRequest<T>({
        requestId,
        queryId,
        document: query,
        options,
        fetchMoreForQueryId,
      }).catch(error => {
        // This is for the benefit of `refetch` promises, which currently don't get their errors
        // through the store like watchQuery observers do
        if (isApolloError(error)) {
          throw error;
        } else {
          if (requestId >= this.getQuery(queryId).lastRequestId) {
            this.queryStore.markQueryError(queryId, error, fetchMoreForQueryId);
            this.invalidate(queryId);
            this.invalidate(fetchMoreForQueryId);
            this.broadcastQueries();
          }
          throw new ApolloError({ networkError: error });
        }
      });

      // we don't return the promise for cache-and-network since it is already
      // returned below from the cache
      if (fetchPolicy !== 'cache-and-network') {
        return networkResult;
      }

      // however we need to catch the error so it isn't unhandled in case of
      // network error
      networkResult.catch(() => {});
    }

    // If there is no part of the query we need to fetch from the server (or,
    // fetchPolicy is cache-only), we just write the store result as the final result.
    this.queryStore.markQueryResultClient(queryId, !shouldFetch);
    this.invalidate(queryId);
    this.invalidate(fetchMoreForQueryId);

    if (this.transform(query).hasForcedResolvers) {
      return this.localState.runResolvers({
        document: query,
        remoteResult: { data: storeResult },
        context,
        variables,
        onlyRunForcedResolvers: true,
      }).then((result: FetchResult<T>) => {
        this.markQueryResult(
          queryId,
          result,
          options,
          fetchMoreForQueryId,
        );
        this.broadcastQueries();
        return result;
      });
    }

    this.broadcastQueries();

    // If we have no query to send to the server, we should return the result
    // found within the store.
    return { data: storeResult };
  }

  private markQueryResult(
    queryId: string,
    result: ExecutionResult,
    {
      fetchPolicy,
      variables,
      errorPolicy,
    }: WatchQueryOptions,
    fetchMoreForQueryId?: string,
  ) {
    if (fetchPolicy === 'no-cache') {
      this.setQuery(queryId, () => ({
        newData: { result: result.data, complete: true },
      }));
    } else {
      const document = this.getQuery(queryId).document!;
      const ignoreErrors = errorPolicy === 'ignore' || errorPolicy === 'all';

      let writeWithErrors = !graphQLResultHasError(result);
      if (ignoreErrors && graphQLResultHasError(result) && result.data) {
        writeWithErrors = true;
      }

      if (!fetchMoreForQueryId && writeWithErrors) {
        this.cache.write({
          result: result.data,
          dataId: 'ROOT_QUERY',
          query: document,
          variables: variables,
        });
      }
    }
  }

  // Returns a query listener that will update the given observer based on the
  // results (or lack thereof) for a particular query.
  public queryListenerForObserver<T>(
    queryId: string,
    options: WatchQueryOptions,
    observer: Observer<ApolloQueryResult<T>>,
  ): QueryListener {
    function invoke(method: 'next' | 'error', argument: any) {
      if (observer[method]) {
        try {
          observer[method]!(argument);
        } catch (e) {
          invariant.error(e);
        }
      } else if (method === 'error') {
        invariant.error(argument);
      }
    }

    return (
      queryStoreValue: QueryStoreValue,
      newData?: Cache.DiffResult<T>,
    ) => {
      // we're going to take a look at the data, so the query is no longer invalidated
      this.invalidate(queryId, false);

      // The query store value can be undefined in the event of a store
      // reset.
      if (!queryStoreValue) return;

      const { observableQuery, document } = this.getQuery(queryId);

      const fetchPolicy = observableQuery
        ? observableQuery.options.fetchPolicy
        : options.fetchPolicy;

      // don't watch the store for queries on standby
      if (fetchPolicy === 'standby') return;

      const loading = isNetworkRequestInFlight(queryStoreValue.networkStatus);
      const lastResult = observableQuery && observableQuery.getLastResult();

      const networkStatusChanged = !!(
        lastResult &&
        lastResult.networkStatus !== queryStoreValue.networkStatus
      );

      const shouldNotifyIfLoading =
        options.returnPartialData ||
        (!newData && queryStoreValue.previousVariables) ||
        (networkStatusChanged && options.notifyOnNetworkStatusChange) ||
        fetchPolicy === 'cache-only' ||
        fetchPolicy === 'cache-and-network';

      if (loading && !shouldNotifyIfLoading) {
        return;
      }

      const hasGraphQLErrors = isNonEmptyArray(queryStoreValue.graphQLErrors);

      const errorPolicy: ErrorPolicy = observableQuery
        && observableQuery.options.errorPolicy
        || options.errorPolicy
        || 'none';

      // If we have either a GraphQL error or a network error, we create
      // an error and tell the observer about it.
      if (errorPolicy === 'none' && hasGraphQLErrors || queryStoreValue.networkError) {
        return invoke('error', new ApolloError({
          graphQLErrors: queryStoreValue.graphQLErrors,
          networkError: queryStoreValue.networkError,
        }));
      }

      try {
        let data: any;
        let isMissing: boolean;

        if (newData) {
          // As long as we're using the cache, clear out the latest
          // `newData`, since it will now become the current data. We need
          // to keep the `newData` stored with the query when using
          // `no-cache` since `getCurrentQueryResult` attemps to pull from
          // `newData` first, following by trying the cache (which won't
          // find a hit for `no-cache`).
          if (fetchPolicy !== 'no-cache' && fetchPolicy !== 'network-only') {
            this.setQuery(queryId, () => ({ newData: null }));
          }

          data = newData.result;
          isMissing = !newData.complete;
        } else {
          const lastError = observableQuery && observableQuery.getLastError();
          const errorStatusChanged =
            errorPolicy !== 'none' &&
            (lastError && lastError.graphQLErrors) !==
              queryStoreValue.graphQLErrors;

          if (lastResult && lastResult.data && !errorStatusChanged) {
            data = lastResult.data;
            isMissing = false;
          } else {
            const diffResult = this.cache.diff({
              query: document as DocumentNode,
              variables:
                queryStoreValue.previousVariables ||
                queryStoreValue.variables,
              returnPartialData: true,
              optimistic: true,
            });

            data = diffResult.result;
            isMissing = !diffResult.complete;
          }
        }

        // If there is some data missing and the user has told us that they
        // do not tolerate partial data then we want to return the previous
        // result and mark it as stale.
        const stale = isMissing && !(
          options.returnPartialData ||
          options.partialRefetch ||
          fetchPolicy === 'cache-only'
        );

        const resultFromStore: ApolloQueryResult<T> = {
          data: stale ? lastResult && lastResult.data : data,
          loading,
          networkStatus: queryStoreValue.networkStatus,
          stale,
        };

        // if the query wants updates on errors we need to add it to the result
        if (errorPolicy === 'all' && hasGraphQLErrors) {
          resultFromStore.errors = queryStoreValue.graphQLErrors;
        }

        invoke('next', resultFromStore);

      } catch (networkError) {
        invoke('error', new ApolloError({ networkError }));
      }
    };
  }

  private transformCache = new (canUseWeakMap ? WeakMap : Map)<
    DocumentNode,
    Readonly<{
      document: Readonly<DocumentNode>;
      hasClientExports: boolean;
      hasForcedResolvers: boolean;
      clientQuery: Readonly<DocumentNode> | null;
      serverQuery: Readonly<DocumentNode> | null;
      defaultVars: Readonly<OperationVariables>;
    }>
  >();

  public transform(document: DocumentNode) {
    const { transformCache } = this;

    if (!transformCache.has(document)) {
      const transformed = this.cache.transformDocument(document);
      const forLink = removeConnectionDirectiveFromDocument(
        this.cache.transformForLink(transformed));

      const clientQuery = this.localState.clientQuery(transformed);
      const serverQuery = this.localState.serverQuery(forLink);

      const cacheEntry = {
        document: transformed,
        // TODO These two calls (hasClientExports and shouldForceResolvers)
        // could probably be merged into a single traversal.
        hasClientExports: hasClientExports(transformed),
        hasForcedResolvers: this.localState.shouldForceResolvers(transformed),
        clientQuery,
        serverQuery,
        defaultVars: getDefaultValues(
          getOperationDefinition(transformed)
        ) as OperationVariables,
      };

      const add = (doc: DocumentNode | null) => {
        if (doc && !transformCache.has(doc)) {
          transformCache.set(doc, cacheEntry);
        }
      }
      // Add cacheEntry to the transformCache using several different keys,
      // since any one of these documents could end up getting passed to the
      // transform method again in the future.
      add(document);
      add(transformed);
      add(clientQuery);
      add(serverQuery);
    }

    return transformCache.get(document)!;
  }

  private getVariables(
    document: DocumentNode,
    variables?: OperationVariables,
  ): OperationVariables {
    return {
      ...this.transform(document).defaultVars,
      ...variables,
    };
  }

  // The shouldSubscribe option is a temporary fix that tells us whether watchQuery was called
  // directly (i.e. through ApolloClient) or through the query method within QueryManager.
  // Currently, the query method uses watchQuery in order to handle non-network errors correctly
  // but we don't want to keep track observables issued for the query method since those aren't
  // supposed to be refetched in the event of a store reset. Once we unify error handling for
  // network errors and non-network errors, the shouldSubscribe option will go away.

  public watchQuery<T, TVariables = OperationVariables>(
    options: WatchQueryOptions,
    shouldSubscribe = true,
  ): ObservableQuery<T, TVariables> {
    invariant(
      options.fetchPolicy !== 'standby',
      'client.watchQuery cannot be called with fetchPolicy set to "standby"',
    );

    // assign variable default values if supplied
    options.variables = this.getVariables(options.query, options.variables);

    if (typeof options.notifyOnNetworkStatusChange === 'undefined') {
      options.notifyOnNetworkStatusChange = false;
    }

    let transformedOptions = { ...options } as WatchQueryOptions<TVariables>;

    const observable = new ObservableQuery<T, TVariables>({
      queryManager: this,
      options: transformedOptions,
      shouldSubscribe: shouldSubscribe,
    });

    this.queryStore.initQuery({
      queryId: observable.queryId,
      document: this.transform(options.query).document,
      variables: options.variables,
      storePreviousVariables: false,
      // Even if options.pollInterval is a number, we have not started
      // polling this query yet (and we have not yet performed the first
      // fetch), so NetworkStatus.loading (not NetworkStatus.poll or
      // NetworkStatus.refetch) is the appropriate status for now.
      isPoll: false,
      isRefetch: false,
      metadata: options.metadata,
      fetchMoreForQueryId: void 0,
    });

    return observable;
  }

  public query<T>(options: QueryOptions): Promise<ApolloQueryResult<T>> {
    invariant(
      options.query,
      'query option is required. You must specify your GraphQL document ' +
        'in the query option.',
    );

    invariant(
      options.query.kind === 'Document',
      'You must wrap the query string in a "gql" tag.',
    );

    invariant(
      !(options as any).returnPartialData,
      'returnPartialData option only supported on watchQuery.',
    );

    invariant(
      !(options as any).pollInterval,
      'pollInterval option only supported on watchQuery.',
    );

    return new Promise<ApolloQueryResult<T>>((resolve, reject) => {
      const watchedQuery = this.watchQuery<T>(options, false);
      this.fetchQueryRejectFns.set(`query:${watchedQuery.queryId}`, reject);
      watchedQuery
        .result()
        .then(resolve, reject)
        // Since neither resolve nor reject throw or return a value, this .then
        // handler is guaranteed to execute. Note that it doesn't really matter
        // when we remove the reject function from this.fetchQueryRejectFns,
        // since resolve and reject are mutually idempotent. In fact, it would
        // not be incorrect to let reject functions accumulate over time; it's
        // just a waste of memory.
        .then(() =>
          this.fetchQueryRejectFns.delete(`query:${watchedQuery.queryId}`),
        );
    });
  }

  public generateQueryId() {
    return String(this.idCounter++);
  }

  public stopQueryInStore(queryId: string) {
    this.stopQueryInStoreNoBroadcast(queryId);
    this.broadcastQueries();
  }

  private stopQueryInStoreNoBroadcast(queryId: string) {
    this.stopPollingQuery(queryId);
    this.queryStore.stopQuery(queryId);
    this.invalidate(queryId);
  }

  public addQueryListener(queryId: string, listener: QueryListener) {
    this.setQuery(queryId, ({ listeners }) => {
      listeners.add(listener);
      return { invalidated: false };
    });
  }

  public updateQueryWatch(
    queryId: string,
    document: DocumentNode,
    options: WatchQueryOptions,
  ) {
    const { cancel } = this.getQuery(queryId);
    if (cancel) cancel();
    const previousResult = () => {
      let previousResult = null;
      const { observableQuery } = this.getQuery(queryId);
      if (observableQuery) {
        const lastResult = observableQuery.getLastResult();
        if (lastResult) {
          previousResult = lastResult.data;
        }
      }

      return previousResult;
    };
    return this.cache.watch({
      query: document as DocumentNode,
      variables: options.variables,
      optimistic: true,
      previousResult,
      callback: newData => {
        this.setQuery(queryId, () => ({ invalidated: true, newData }));
      },
    });
  }

  // Adds an ObservableQuery to this.observableQueries and to this.observableQueriesByName.
  public addObservableQuery<T>(
    queryId: string,
    observableQuery: ObservableQuery<T>,
  ) {
    this.setQuery(queryId, () => ({ observableQuery }));
  }

  public removeObservableQuery(queryId: string) {
    const { cancel } = this.getQuery(queryId);
    this.setQuery(queryId, () => ({ observableQuery: null }));
    if (cancel) cancel();
  }

  public clearStore(): Promise<void> {
    // Before we have sent the reset action to the store,
    // we can no longer rely on the results returned by in-flight
    // requests since these may depend on values that previously existed
    // in the data portion of the store. So, we cancel the promises and observers
    // that we have issued so far and not yet resolved (in the case of
    // queries).
    this.fetchQueryRejectFns.forEach(reject => {
      reject(new InvariantError(
        'Store reset while query was in flight (not completed in link chain)',
      ));
    });

    const resetIds: string[] = [];
    this.queries.forEach(({ observableQuery }, queryId) => {
      if (observableQuery) resetIds.push(queryId);
    });

    this.queryStore.reset(resetIds);
    this.mutationStore.reset();

    // begin removing data from the store
    return this.cache.reset();
  }

  public resetStore(): Promise<ApolloQueryResult<any>[]> {
    // Similarly, we have to have to refetch each of the queries currently being
    // observed. We refetch instead of error'ing on these since the assumption is that
    // resetting the store doesn't eliminate the need for the queries currently being
    // watched. If there is an existing query in flight when the store is reset,
    // the promise for it will be rejected and its results will not be written to the
    // store.
    return this.clearStore().then(() => {
      return this.reFetchObservableQueries();
    });
  }

  public reFetchObservableQueries(
    includeStandby: boolean = false,
  ): Promise<ApolloQueryResult<any>[]> {
    const observableQueryPromises: Promise<ApolloQueryResult<any>>[] = [];

    this.queries.forEach(({ observableQuery }, queryId) => {
      if (observableQuery) {
        const fetchPolicy = observableQuery.options.fetchPolicy;

        observableQuery.resetLastResults();
        if (
          fetchPolicy !== 'cache-only' &&
          (includeStandby || fetchPolicy !== 'standby')
        ) {
          observableQueryPromises.push(observableQuery.refetch());
        }

        this.setQuery(queryId, () => ({ newData: null }));
        this.invalidate(queryId);
      }
    });

    this.broadcastQueries();

    return Promise.all(observableQueryPromises);
  }

  public observeQuery<T>(
    queryId: string,
    options: WatchQueryOptions,
    observer: Observer<ApolloQueryResult<T>>,
  ) {
    this.addQueryListener(
      queryId,
      this.queryListenerForObserver(queryId, options, observer),
    );
    return this.fetchQuery<T>(queryId, options);
  }

  public startGraphQLSubscription<T = any>({
    query,
    fetchPolicy,
    variables,
  }: SubscriptionOptions): Observable<FetchResult<T>> {
    query = this.transform(query).document;
    variables = this.getVariables(query, variables);

    const makeObservable = (variables: OperationVariables) =>
      this.getObservableFromLink<T>(
        query,
        {},
        variables,
        false,
      ).map(result => {
        if (!fetchPolicy || fetchPolicy !== 'no-cache') {
          // the subscription interface should handle not sending us results we no longer subscribe to.
          // XXX I don't think we ever send in an object with errors, but we might in the future...
          if (!graphQLResultHasError(result)) {
            this.cache.write({
              query,
              result: result.data,
              dataId: 'ROOT_SUBSCRIPTION',
              variables: variables,
            });
          }

          this.broadcastQueries();
        }

        if (graphQLResultHasError(result)) {
          throw new ApolloError({
            graphQLErrors: result.errors,
          });
        }

        return result;
      });

    if (this.transform(query).hasClientExports) {
      const observablePromise = this.localState.addExportedVariables(
        query,
        variables,
      ).then(makeObservable);

      return new Observable<FetchResult<T>>(observer => {
        let sub: ObservableSubscription | null = null;
        observablePromise.then(
          observable => sub = observable.subscribe(observer),
          observer.error,
        );
        return () => sub && sub.unsubscribe();
      });
    }

    return makeObservable(variables);
  }

  public stopQuery(queryId: string) {
    this.stopQueryNoBroadcast(queryId);
    this.broadcastQueries();
  }

  private stopQueryNoBroadcast(queryId: string) {
    this.stopQueryInStoreNoBroadcast(queryId);
    this.removeQuery(queryId);
  }

  public removeQuery(queryId: string) {
    // teardown all links
    // Both `QueryManager.fetchRequest` and `QueryManager.query` create separate promises
    // that each add their reject functions to fetchQueryRejectFns.
    // A query created with `QueryManager.query()` could trigger a `QueryManager.fetchRequest`.
    // The same queryId could have two rejection fns for two promises
    this.fetchQueryRejectFns.delete(`query:${queryId}`);
    this.fetchQueryRejectFns.delete(`fetchRequest:${queryId}`);
    this.getQuery(queryId).subscriptions.forEach(x => x.unsubscribe());
    this.queries.delete(queryId);
  }

  public getCurrentQueryResult<T>(
    observableQuery: ObservableQuery<T>,
    optimistic: boolean = true,
  ): {
    data: T | undefined;
    partial: boolean;
  } {
    const { variables, query, fetchPolicy, returnPartialData } = observableQuery.options;
    const lastResult = observableQuery.getLastResult();
    const { newData } = this.getQuery(observableQuery.queryId);

    if (newData && newData.complete) {
      return { data: newData.result, partial: false };
    }

    if (fetchPolicy === 'no-cache' || fetchPolicy === 'network-only') {
      return { data: undefined, partial: false };
    }

    const { result, complete } = this.cache.diff<T>({
      query,
      variables,
      previousResult: lastResult ? lastResult.data : undefined,
      returnPartialData: true,
      optimistic,
    });

    return {
      data: (complete || returnPartialData) ? result : void 0,
      partial: !complete,
    };
  }

  public getQueryWithPreviousResult<TData, TVariables = OperationVariables>(
    queryIdOrObservable: string | ObservableQuery<TData, TVariables>,
  ): {
    previousResult: any;
    variables: TVariables | undefined;
    document: DocumentNode;
  } {
    let observableQuery: ObservableQuery<TData, any>;
    if (typeof queryIdOrObservable === 'string') {
      const { observableQuery: foundObservableQuery } = this.getQuery(
        queryIdOrObservable,
      );
      invariant(
        foundObservableQuery,
        `ObservableQuery with this id doesn't exist: ${queryIdOrObservable}`
      );
      observableQuery = foundObservableQuery!;
    } else {
      observableQuery = queryIdOrObservable;
    }

    const { variables, query } = observableQuery.options;
    return {
      previousResult: this.getCurrentQueryResult(observableQuery, false).data,
      variables,
      document: query,
    };
  }

  public broadcastQueries() {
    this.onBroadcast();
    this.queries.forEach((info, id) => {
      if (info.invalidated) {
        info.listeners.forEach(listener => {
          // it's possible for the listener to be undefined if the query is being stopped
          // See here for more detail: https://github.com/apollostack/apollo-client/issues/231
          if (listener) {
            listener(this.queryStore.get(id), info.newData);
          }
        });
      }
    });
  }

  public getLocalState(): LocalState<TStore> {
    return this.localState;
  }

  private inFlightLinkObservables = new Map<
    DocumentNode,
    Map<string, Observable<FetchResult>>
  >();

  private getObservableFromLink<T = any>(
    query: DocumentNode,
    context: any,
    variables?: OperationVariables,
    deduplication: boolean = this.queryDeduplication,
  ): Observable<FetchResult<T>> {
    let observable: Observable<FetchResult<T>>;

    const { serverQuery } = this.transform(query);
    if (serverQuery) {
      const { inFlightLinkObservables, link } = this;

      const operation = {
        query: serverQuery,
        variables,
        operationName: getOperationName(serverQuery) || void 0,
        context: this.prepareContext({
          ...context,
          forceFetch: !deduplication
        }),
      };

      context = operation.context;

      if (deduplication) {
        const byVariables = inFlightLinkObservables.get(serverQuery) || new Map();
        inFlightLinkObservables.set(serverQuery, byVariables);

        const varJson = JSON.stringify(variables);
        observable = byVariables.get(varJson);

        if (!observable) {
          byVariables.set(
            varJson,
            observable = multiplex(
              execute(link, operation) as Observable<FetchResult<T>>
            )
          );

          const cleanup = () => {
            byVariables.delete(varJson);
            if (!byVariables.size) inFlightLinkObservables.delete(serverQuery);
            cleanupSub.unsubscribe();
          };

          const cleanupSub = observable.subscribe({
            next: cleanup,
            error: cleanup,
            complete: cleanup,
          });
        }

      } else {
        observable = multiplex(execute(link, operation) as Observable<FetchResult<T>>);
      }
    } else {
      observable = Observable.of({ data: {} } as FetchResult<T>);
      context = this.prepareContext(context);
    }

    const { clientQuery } = this.transform(query);
    if (clientQuery) {
      observable = asyncMap(observable, result => {
        return this.localState.runResolvers({
          document: clientQuery,
          remoteResult: result,
          context,
          variables,
        });
      });
    }

    return observable;
  }

  // Takes a request id, query id, a query document and information associated with the query
  // and send it to the network interface. Returns
  // a promise for the result associated with that request.
  private fetchRequest<T>({
    requestId,
    queryId,
    document,
    options,
    fetchMoreForQueryId,
  }: {
    requestId: number;
    queryId: string;
    document: DocumentNode;
    options: WatchQueryOptions;
    fetchMoreForQueryId?: string;
  }): Promise<FetchResult<T>> {
    const { variables, errorPolicy = 'none', fetchPolicy } = options;
    let resultFromStore: any;
    let errorsFromStore: any;

    return new Promise<ApolloQueryResult<T>>((resolve, reject) => {
      const observable = this.getObservableFromLink(
        document,
        options.context,
        variables,
      );

      const fqrfId = `fetchRequest:${queryId}`;
      this.fetchQueryRejectFns.set(fqrfId, reject);

      const cleanup = () => {
        this.fetchQueryRejectFns.delete(fqrfId);
        this.setQuery(queryId, ({ subscriptions }) => {
          subscriptions.delete(subscription);
        });
      };

      const subscription = observable.map((result: ExecutionResult) => {
        if (requestId >= this.getQuery(queryId).lastRequestId) {
          this.markQueryResult(
            queryId,
            result,
            options,
            fetchMoreForQueryId,
          );

          this.queryStore.markQueryResult(
            queryId,
            result,
            fetchMoreForQueryId,
          );

          this.invalidate(queryId);
          this.invalidate(fetchMoreForQueryId);

          this.broadcastQueries();
        }

        if (errorPolicy === 'none' && isNonEmptyArray(result.errors)) {
          return reject(new ApolloError({
            graphQLErrors: result.errors,
          }));
        }

        if (errorPolicy === 'all') {
          errorsFromStore = result.errors;
        }

        if (fetchMoreForQueryId || fetchPolicy === 'no-cache') {
          // We don't write fetchMore results to the store because this would overwrite
          // the original result in case an @connection directive is used.
          resultFromStore = result.data;
        } else {
          // ensure result is combined with data already in store
          const { result, complete } = this.cache.diff<T>({
            variables,
            query: document,
            optimistic: false,
            returnPartialData: true,
          });

          if (complete || options.returnPartialData) {
            resultFromStore = result;
          }
        }
      }).subscribe({
        error(error: ApolloError) {
          cleanup();
          reject(error);
        },

        complete() {
          cleanup();
          resolve({
            data: resultFromStore,
            errors: errorsFromStore,
            loading: false,
            networkStatus: NetworkStatus.ready,
            stale: false,
          });
        },
      });

      this.setQuery(queryId, ({ subscriptions }) => {
        subscriptions.add(subscription);
      });
    });
  }

  private getQuery(queryId: string) {
    return (
      this.queries.get(queryId) || {
        listeners: new Set<QueryListener>(),
        invalidated: false,
        document: null,
        newData: null,
        lastRequestId: 1,
        observableQuery: null,
        subscriptions: new Set<ObservableSubscription>(),
      }
    );
  }

  public setQuery<T extends keyof QueryInfo>(
    queryId: string,
    updater: (prev: QueryInfo) => Pick<QueryInfo, T> | void,
  ) {
    const prev = this.getQuery(queryId);
    const newInfo = { ...prev, ...updater(prev) };
    this.queries.set(queryId, newInfo);
  }

  private invalidate(
    queryId: string | undefined,
    invalidated = true,
  ) {
    if (queryId) {
      this.setQuery(queryId, () => ({ invalidated }));
    }
  }

  private prepareContext(context = {}) {
    const newContext = this.localState.prepareContext(context);
    return {
      ...newContext,
      clientAwareness: this.clientAwareness,
    };
  }

  public checkInFlight(queryId: string) {
    const query = this.queryStore.get(queryId);

    return (
      query &&
      query.networkStatus !== NetworkStatus.ready &&
      query.networkStatus !== NetworkStatus.error
    );
  }

  // Map from client ID to { interval, options }.
  private pollingInfoByQueryId = new Map<string, {
    interval: number;
    timeout: NodeJS.Timeout;
    options: WatchQueryOptions;
  }>();

  public startPollingQuery(
    options: WatchQueryOptions,
    queryId: string,
    listener?: QueryListener,
  ): string {
    const { pollInterval } = options;

    invariant(
      pollInterval,
      'Attempted to start a polling query without a polling interval.',
    );

    // Do not poll in SSR mode
    if (!this.ssrMode) {
      let info = this.pollingInfoByQueryId.get(queryId)!;
      if (!info) {
        this.pollingInfoByQueryId.set(queryId, (info = {} as any));
      }

      info.interval = pollInterval!;
      info.options = {
        ...options,
        fetchPolicy: 'network-only',
      };

      const maybeFetch = () => {
        const info = this.pollingInfoByQueryId.get(queryId);
        if (info) {
          if (this.checkInFlight(queryId)) {
            poll();
          } else {
            this.fetchQuery(queryId, info.options, FetchType.poll).then(
              poll,
              poll,
            );
          }
        }
      };

      const poll = () => {
        const info = this.pollingInfoByQueryId.get(queryId);
        if (info) {
          clearTimeout(info.timeout);
          info.timeout = setTimeout(maybeFetch, info.interval);
        }
      };

      if (listener) {
        this.addQueryListener(queryId, listener);
      }

      poll();
    }

    return queryId;
  }

  public stopPollingQuery(queryId: string) {
    this.pollingInfoByQueryId.delete(queryId);
  }
}

function markMutationResult<TStore>(
  mutation: {
    mutationId: string;
    result: ExecutionResult;
    document: DocumentNode;
    variables: any;
    queryUpdatersById: Record<string, QueryWithUpdater>;
    update:
      ((cache: ApolloCache<TStore>, mutationResult: Object) => void) |
      undefined;
  },
  cache: ApolloCache<TStore>,
) {
  // Incorporate the result from this mutation into the store
  if (!graphQLResultHasError(mutation.result)) {
    const cacheWrites: Cache.WriteOptions[] = [{
      result: mutation.result.data,
      dataId: 'ROOT_MUTATION',
      query: mutation.document,
      variables: mutation.variables,
    }];

    const { queryUpdatersById } = mutation;
    if (queryUpdatersById) {
      Object.keys(queryUpdatersById).forEach(id => {
        const { query, updater } = queryUpdatersById[id];

        // Read the current query result from the store.
        const { result: currentQueryResult, complete } = cache.diff({
          query: query.document,
          variables: query.variables,
          returnPartialData: true,
          optimistic: false,
        });

        if (complete) {
          // Run our reducer using the current query result and the mutation result.
          const nextQueryResult = tryFunctionOrLogError(
            () => updater(currentQueryResult, {
              mutationResult: mutation.result,
              queryName: getOperationName(query.document) || undefined,
              queryVariables: query.variables,
            }),
          );

          // Write the modified result back into the store if we got a new result.
          if (nextQueryResult) {
            cacheWrites.push({
              result: nextQueryResult,
              dataId: 'ROOT_QUERY',
              query: query.document,
              variables: query.variables,
            });
          }
        }
      });
    }

    cache.performTransaction(c => {
      cacheWrites.forEach(write => c.write(write));

      // If the mutation has some writes associated with it then we need to
      // apply those writes to the store by running this reducer again with a
      // write action.
      const { update } = mutation;
      if (update) {
        tryFunctionOrLogError(() => update(c, mutation.result));
      }
    });
  }
}
