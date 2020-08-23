import { DocumentNode } from 'graphql';
import { invariant, InvariantError } from 'ts-invariant';
import { equal } from '@wry/equality';

import { ApolloLink, execute, FetchResult } from '../link/core';
import { Cache, ApolloCache } from '../cache';

import {
  getDefaultValues,
  getOperationDefinition,
  getOperationName,
  hasClientExports,
  graphQLResultHasError,
  removeConnectionDirectiveFromDocument,
  canUseWeakMap,
  ObservableSubscription,
  Observable,
  asyncMap,
  isNonEmptyArray,
  Concast,
  ConcastSourcesIterable,
} from '../utilities';
import { ApolloError, isApolloError } from '../errors';
import { MutationStore } from './MutationStore';
import {
  QueryOptions,
  WatchQueryOptions,
  SubscriptionOptions,
  MutationOptions,
  WatchQueryFetchPolicy,
  ErrorPolicy,
} from './watchQueryOptions';
import { ObservableQuery } from './ObservableQuery';
import { NetworkStatus, isNetworkRequestInFlight } from './networkStatus';
import {
  ApolloQueryResult,
  OperationVariables,
  MutationQueryReducer,
} from './types';
import { LocalState } from './LocalState';

import { QueryInfo, QueryStoreValue } from './QueryInfo';

const { hasOwnProperty } = Object.prototype;

type QueryWithUpdater = {
  updater: MutationQueryReducer<Object>;
  queryInfo: QueryInfo;
};

export class QueryManager<TStore> {
  public cache: ApolloCache<TStore>;
  public link: ApolloLink;
  public mutationStore: MutationStore = new MutationStore();
  public readonly assumeImmutableResults: boolean;
  public readonly ssrMode: boolean;

  private queryDeduplication: boolean;
  private clientAwareness: Record<string, string> = {};
  private localState: LocalState<TStore>;

  private onBroadcast: () => void;

  // All the queries that the QueryManager is currently managing (not
  // including mutations and subscriptions).
  private queries = new Map<string, QueryInfo>();

  // Maps from queryId strings to Promise rejection functions for
  // currently active queries and fetches.
  private fetchCancelFns = new Map<string, (error: any) => any>();

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

    this.cancelPendingFetches(
      new InvariantError('QueryManager stopped while query was in flight'),
    );
  }

  private cancelPendingFetches(error: Error) {
    this.fetchCancelFns.forEach(cancel => cancel(error));
    this.fetchCancelFns.clear();
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

    const mutationId = this.generateMutationId();
    mutation = this.transform(mutation).document;

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
                queryInfo: this.queries.get(queryId)!,
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
        try {
          markMutationResult({
            mutationId: mutationId,
            result: { data: optimistic },
            document: mutation,
            variables: variables,
            queryUpdatersById: generateUpdateQueriesInfo(),
            update: updateWithProxyFn,
          }, cache);
        } catch (error) {
          invariant.error(error);
        }
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
        next(result: FetchResult<T>) {
          if (graphQLResultHasError(result) && errorPolicy === 'none') {
            error = new ApolloError({
              graphQLErrors: result.errors,
            });
            return;
          }

          self.mutationStore.markMutationResult(mutationId);

          if (fetchPolicy !== 'no-cache') {
            try {
              markMutationResult({
                mutationId,
                result,
                document: mutation,
                variables,
                queryUpdatersById: generateUpdateQueriesInfo(),
                update: updateWithProxyFn,
              }, self.cache);
            } catch (e) {
              error = new ApolloError({
                networkError: e,
              });
              return;
            }
          }

          storeResult = result;
        },

        error(err: Error) {
          self.mutationStore.markMutationError(mutationId, err);
          if (optimisticResponse) {
            self.cache.removeOptimistic(mutationId);
          }
          self.broadcastQueries();
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
            refetchQueries = refetchQueries(storeResult!);
          }

          const refetchQueryPromises: Promise<
            ApolloQueryResult<any>[] | ApolloQueryResult<{}>
          >[] = [];

          if (isNonEmptyArray(refetchQueries)) {
            refetchQueries.forEach(refetchQuery => {
              if (typeof refetchQuery === 'string') {
                self.queries.forEach(({ observableQuery }) => {
                  if (observableQuery &&
                      observableQuery.queryName === refetchQuery) {
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
            if (
              errorPolicy === 'ignore' &&
              storeResult &&
              graphQLResultHasError(storeResult)
            ) {
              delete storeResult.errors;
            }

            resolve(storeResult!);
          }, reject);
        },
      });
    });
  }

  public fetchQuery<TData, TVars>(
    queryId: string,
    options: WatchQueryOptions<TVars>,
    networkStatus?: NetworkStatus,
  ): Promise<ApolloQueryResult<TData>> {
    return this.fetchQueryObservable<TData, TVars>(
      queryId,
      options,
      networkStatus,
    ).promise;
  }

  public getQueryStore() {
    const store: Record<string, QueryStoreValue> = Object.create(null);
    this.queries.forEach((info, queryId) => {
      store[queryId] = {
        variables: info.variables,
        networkStatus: info.networkStatus,
        networkError: info.networkError,
        graphQLErrors: info.graphQLErrors,
      };
    });
    return store;
  }

  public resetErrors(queryId: string) {
    const queryInfo = this.queries.get(queryId);
    if (queryInfo) {
      queryInfo.networkError = undefined;
      queryInfo.graphQLErrors = [];
    }
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
      const serverQuery = forLink && this.localState.serverQuery(forLink);

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

  public watchQuery<T, TVariables = OperationVariables>(
    options: WatchQueryOptions<TVariables>,
  ): ObservableQuery<T, TVariables> {
    // assign variable default values if supplied
    options = {
      ...options,
      variables: this.getVariables(
        options.query,
        options.variables,
      ) as TVariables,
    };

    if (typeof options.notifyOnNetworkStatusChange === 'undefined') {
      options.notifyOnNetworkStatusChange = false;
    }

    const queryInfo = new QueryInfo(this.cache);
    const observable = new ObservableQuery<T, TVariables>({
      queryManager: this,
      queryInfo,
      options,
    });

    this.queries.set(observable.queryId, queryInfo);

    queryInfo.init({
      document: options.query,
      observableQuery: observable,
      variables: options.variables,
    });

    return observable;
  }

  public query<TData, TVars = OperationVariables>(
    options: QueryOptions<TVars>,
  ): Promise<ApolloQueryResult<TData>> {
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

    const queryId = this.generateQueryId();
    return this.fetchQuery<TData, TVars>(
      queryId,
      options,
    ).finally(() => this.stopQuery(queryId));
  }

  private queryIdCounter = 1;
  public generateQueryId() {
    return String(this.queryIdCounter++);
  }

  private requestIdCounter = 1;
  public generateRequestId() {
    return this.requestIdCounter++;
  }

  private mutationIdCounter = 1;
  public generateMutationId() {
    return String(this.mutationIdCounter++);
  }

  public stopQueryInStore(queryId: string) {
    this.stopQueryInStoreNoBroadcast(queryId);
    this.broadcastQueries();
  }

  private stopQueryInStoreNoBroadcast(queryId: string) {
    const queryInfo = this.queries.get(queryId);
    if (queryInfo) queryInfo.stop();
  }

  public clearStore(): Promise<void> {
    // Before we have sent the reset action to the store, we can no longer
    // rely on the results returned by in-flight requests since these may
    // depend on values that previously existed in the data portion of the
    // store. So, we cancel the promises and observers that we have issued
    // so far and not yet resolved (in the case of queries).
    this.cancelPendingFetches(new InvariantError(
      'Store reset while query was in flight (not completed in link chain)',
    ));

    this.queries.forEach(queryInfo => {
      if (queryInfo.observableQuery) {
        // Set loading to true so listeners don't trigger unless they want
        // results with partial data.
        queryInfo.networkStatus = NetworkStatus.loading;
      } else {
        queryInfo.stop();
      }
    });

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

        this.getQuery(queryId).setDiff(null);
      }
    });

    this.broadcastQueries();

    return Promise.all(observableQueryPromises);
  }

  public setObservableQuery(observableQuery: ObservableQuery<any, any>) {
    this.getQuery(observableQuery.queryId).setObservableQuery(observableQuery);
  }

  public startGraphQLSubscription<T = any>({
    query,
    fetchPolicy,
    variables,
    context = {},
  }: SubscriptionOptions): Observable<FetchResult<T>> {
    query = this.transform(query).document;
    variables = this.getVariables(query, variables);

    const makeObservable = (variables: OperationVariables) =>
      this.getObservableFromLink<T>(
        query,
        context,
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
        context,
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
    // that each add their reject functions to fetchCancelFns.
    // A query created with `QueryManager.query()` could trigger a `QueryManager.fetchRequest`.
    // The same queryId could have two rejection fns for two promises
    this.fetchCancelFns.delete(queryId);
    this.getQuery(queryId).subscriptions.forEach(x => x.unsubscribe());
    this.queries.delete(queryId);
  }

  public broadcastQueries() {
    this.onBroadcast();
    this.queries.forEach(info => info.notify());
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
    deduplication: boolean =
      // Prefer context.queryDeduplication if specified.
      context?.queryDeduplication ??
      this.queryDeduplication,
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
          const concast = new Concast([
            execute(link, operation) as Observable<FetchResult<T>>
          ]);

          byVariables.set(varJson, observable = concast);

          concast.cleanup(() => {
            if (byVariables.delete(varJson) &&
                byVariables.size < 1) {
              inFlightLinkObservables.delete(serverQuery);
            }
          });
        }

      } else {
        observable = new Concast([
          execute(link, operation) as Observable<FetchResult<T>>
        ]);
      }
    } else {
      observable = new Concast([
        Observable.of({ data: {} } as FetchResult<T>)
      ]);
      context = this.prepareContext(context);
    }

    const { clientQuery } = this.transform(query);
    if (clientQuery) {
      observable = asyncMap(observable, result => {
        if (graphQLResultHasError(result)) {
          return result;
        }
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

  private getResultsFromLink<TData, TVars>(
    queryInfo: QueryInfo,
    allowCacheWrite: boolean,
    options: Pick<WatchQueryOptions<TVars>,
      | "variables"
      | "context"
      | "fetchPolicy"
      | "errorPolicy">,
  ): Observable<ApolloQueryResult<TData>> {
    const { lastRequestId } = queryInfo;

    return asyncMap(
      this.getObservableFromLink(
        queryInfo.document!,
        options.context,
        options.variables,
      ),

      result => {
        const hasErrors = isNonEmptyArray(result.errors);

        if (lastRequestId >= queryInfo.lastRequestId) {
          if (hasErrors && options.errorPolicy === "none") {
            // Throwing here effectively calls observer.error.
            throw queryInfo.markError(new ApolloError({
              graphQLErrors: result.errors,
            }));
          }
          queryInfo.markResult(result, options, allowCacheWrite);
          queryInfo.markReady();
        }

        const aqr: ApolloQueryResult<TData> = {
          data: result.data,
          loading: false,
          networkStatus: queryInfo.networkStatus || NetworkStatus.ready,
        };

        if (hasErrors && options.errorPolicy !== "ignore") {
          aqr.errors = result.errors;
        }

        return aqr;
      },

      networkError => {
        const error = isApolloError(networkError)
          ? networkError
          : new ApolloError({ networkError });

        if (lastRequestId >= queryInfo.lastRequestId) {
          queryInfo.markError(error);
        }

        throw error;
      },
    );
  }

  public fetchQueryObservable<TData, TVars>(
    queryId: string,
    options: WatchQueryOptions<TVars>,
    // The initial networkStatus for this fetch, most often
    // NetworkStatus.loading, but also possibly fetchMore, poll, refetch,
    // or setVariables.
    networkStatus = NetworkStatus.loading,
  ): Concast<ApolloQueryResult<TData>> {
    const query = this.transform(options.query).document;
    const variables = this.getVariables(query, options.variables) as TVars;
    const queryInfo = this.getQuery(queryId);
    const oldNetworkStatus = queryInfo.networkStatus;

    let {
      fetchPolicy = "cache-first" as WatchQueryFetchPolicy,
      errorPolicy = "none" as ErrorPolicy,
      returnPartialData = false,
      notifyOnNetworkStatusChange = false,
      context = {},
    } = options;

    const mightUseNetwork =
      fetchPolicy === "cache-first" ||
      fetchPolicy === "cache-and-network" ||
      fetchPolicy === "network-only" ||
      fetchPolicy === "no-cache";

    if (mightUseNetwork &&
        notifyOnNetworkStatusChange &&
        typeof oldNetworkStatus === "number" &&
        oldNetworkStatus !== networkStatus &&
        isNetworkRequestInFlight(networkStatus)) {
      // In order to force delivery of an incomplete cache result with
      // loading:true, we tweak the fetchPolicy to include the cache, and
      // pretend that returnPartialData was enabled.
      if (fetchPolicy !== "cache-first") {
        fetchPolicy = "cache-and-network";
      }
      returnPartialData = true;
    }

    const normalized = Object.assign({}, options, {
      query,
      variables,
      fetchPolicy,
      errorPolicy,
      returnPartialData,
      notifyOnNetworkStatusChange,
      context,
    });

    const fromVariables = (variables: TVars) => {
      // Since normalized is always a fresh copy of options, it's safe to
      // modify its properties here, rather than creating yet another new
      // WatchQueryOptions object.
      normalized.variables = variables;
      return this.fetchQueryByPolicy<TData, TVars>(
        queryInfo,
        normalized,
        networkStatus,
      );
    };

    // This cancel function needs to be set before the concast is created,
    // in case concast creation synchronously cancels the request.
    this.fetchCancelFns.set(queryId, reason => {
      // Delaying the cancellation using a Promise ensures that the
      // concast variable has been initialized.
      Promise.resolve().then(() => concast.cancel(reason));
    });

    // A Concast<T> can be created either from an Iterable<Observable<T>>
    // or from a PromiseLike<Iterable<Observable<T>>>, where T in this
    // case is ApolloQueryResult<TData>.
    const concast = new Concast(
      // If the query has @export(as: ...) directives, then we need to
      // process those directives asynchronously. When there are no
      // @export directives (the common case), we deliberately avoid
      // wrapping the result of this.fetchQueryByPolicy in a Promise,
      // since the timing of result delivery is (unfortunately) important
      // for backwards compatibility. TODO This code could be simpler if
      // we deprecated and removed LocalState.
      this.transform(normalized.query).hasClientExports
        ? this.localState.addExportedVariables(
          normalized.query,
          normalized.variables,
          normalized.context,
        ).then(fromVariables)
        : fromVariables(normalized.variables!)
    );

    concast.cleanup(() => {
      this.fetchCancelFns.delete(queryId);

      if (options.nextFetchPolicy) {
        // When someone chooses cache-and-network or network-only as their
        // initial FetchPolicy, they often do not want future cache updates to
        // trigger unconditional network requests, which is what repeatedly
        // applying the cache-and-network or network-only policies would seem
        // to imply. Instead, when the cache reports an update after the
        // initial network request, it may be desirable for subsequent network
        // requests to be triggered only if the cache result is incomplete.
        // The options.nextFetchPolicy option provides an easy way to update
        // options.fetchPolicy after the intial network request, without
        // having to call observableQuery.setOptions.
        options.fetchPolicy = options.nextFetchPolicy;
        // The options.nextFetchPolicy transition should happen only once.
        options.nextFetchPolicy = void 0;
      }
    });

    return concast;
  }

  private fetchQueryByPolicy<TData, TVars>(
    queryInfo: QueryInfo,
    options: WatchQueryOptions<TVars>,
    // The initial networkStatus for this fetch, most often
    // NetworkStatus.loading, but also possibly fetchMore, poll, refetch,
    // or setVariables.
    networkStatus: NetworkStatus,
  ): ConcastSourcesIterable<ApolloQueryResult<TData>> {
    const {
      query,
      variables,
      fetchPolicy,
      errorPolicy,
      returnPartialData,
      context,
    } = options;

    queryInfo.init({
      document: query,
      variables,
      lastRequestId: this.generateRequestId(),
      networkStatus,
    });

    const readCache = () => queryInfo.getDiff(variables);

    const resultsFromCache = (
      diff: Cache.DiffResult<TData>,
      networkStatus = queryInfo.networkStatus || NetworkStatus.loading,
    ) => {
      const data = diff.result as TData;

      if (process.env.NODE_ENV !== 'production' &&
          isNonEmptyArray(diff.missing) &&
          !equal(data, {})) {
        invariant.warn(`Missing cache result fields: ${
          diff.missing.map(m => m.path.join('.')).join(', ')
        }`, diff.missing);
      }

      const fromData = (data: TData) => Observable.of({
        data,
        loading: isNetworkRequestInFlight(networkStatus),
        networkStatus,
        ...(diff.complete ? null : { partial: true }),
      } as ApolloQueryResult<TData>);

      if (this.transform(query).hasForcedResolvers) {
        return this.localState.runResolvers({
          document: query,
          remoteResult: { data },
          context,
          variables,
          onlyRunForcedResolvers: true,
        }).then(resolved => fromData(resolved.data!));
      }

      return fromData(data);
    };

    const resultsFromLink = (allowCacheWrite: boolean) =>
      this.getResultsFromLink<TData, TVars>(queryInfo, allowCacheWrite, {
        variables,
        context,
        fetchPolicy,
        errorPolicy,
      });

    switch (fetchPolicy) {
    default: case "cache-first": {
      const diff = readCache();

      if (diff.complete) {
        return [
          resultsFromCache(diff, queryInfo.markReady()),
        ];
      }

      if (returnPartialData) {
        return [
          resultsFromCache(diff),
          resultsFromLink(true),
        ];
      }

      return [
        resultsFromLink(true),
      ];
    }

    case "cache-and-network": {
      const diff = readCache();

      if (diff.complete || returnPartialData) {
        return [
          resultsFromCache(diff),
          resultsFromLink(true),
        ];
      }

      return [
        resultsFromLink(true),
      ];
    }

    case "cache-only":
      return [
        resultsFromCache(readCache(), queryInfo.markReady()),
      ];

    case "network-only":
      return [resultsFromLink(true)];

    case "no-cache":
      return [resultsFromLink(false)];

    case "standby":
      return [];
    }
  }

  private getQuery(queryId: string): QueryInfo {
    if (queryId && !this.queries.has(queryId)) {
      this.queries.set(queryId, new QueryInfo(this.cache));
    }
    return this.queries.get(queryId)!;
  }

  private prepareContext(context = {}) {
    const newContext = this.localState.prepareContext(context);
    return {
      ...newContext,
      clientAwareness: this.clientAwareness,
    };
  }
}

function markMutationResult<TStore, TData>(
  mutation: {
    mutationId: string;
    result: FetchResult<TData>;
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
        const {
          updater,
          queryInfo: {
            document,
            variables,
          },
        } = queryUpdatersById[id];

        // Read the current query result from the store.
        const { result: currentQueryResult, complete } = cache.diff<TData>({
          query: document!,
          variables,
          returnPartialData: true,
          optimistic: false,
        });

        if (complete && currentQueryResult) {
          // Run our reducer using the current query result and the mutation result.
          const nextQueryResult = updater(currentQueryResult, {
            mutationResult: mutation.result,
            queryName: getOperationName(document!) || undefined,
            queryVariables: variables!,
          });

          // Write the modified result back into the store if we got a new result.
          if (nextQueryResult) {
            cacheWrites.push({
              result: nextQueryResult,
              dataId: 'ROOT_QUERY',
              query: document!,
              variables,
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
        update(c, mutation.result);
      }
    }, /* non-optimistic transaction: */ null);
  }
}
