import { DocumentNode } from 'graphql';
import { invariant, InvariantError } from 'ts-invariant';
import { equal } from '@wry/equality';

import { ApolloLink, execute, FetchResult } from '../link/core';
import { Cache, ApolloCache, canonicalStringify } from '../cache';

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
  makeUniqueId,
  isDocumentNode,
  isNonNullObject,
} from '../utilities';
import { ApolloError, isApolloError } from '../errors';
import {
  QueryOptions,
  WatchQueryOptions,
  SubscriptionOptions,
  MutationOptions,
  WatchQueryFetchPolicy,
  ErrorPolicy,
} from './watchQueryOptions';
import { ObservableQuery, applyNextFetchPolicy } from './ObservableQuery';
import { NetworkStatus, isNetworkRequestInFlight } from './networkStatus';
import {
  ApolloQueryResult,
  OperationVariables,
  MutationUpdaterFunction,
  OnQueryUpdated,
  InternalRefetchQueriesInclude,
  InternalRefetchQueriesOptions,
  InternalRefetchQueriesResult,
  InternalRefetchQueriesMap,
} from './types';
import { LocalState } from './LocalState';

import {
  QueryInfo,
  QueryStoreValue,
  shouldWriteResult,
  CacheWriteBehavior,
} from './QueryInfo';

const { hasOwnProperty } = Object.prototype;

interface MutationStoreValue {
  mutation: DocumentNode;
  variables: Record<string, any>;
  loading: boolean;
  error: Error | null;
}

type UpdateQueries<TData> = MutationOptions<TData, any, any>["updateQueries"];

interface TransformCacheEntry {
  document: DocumentNode;
  hasClientExports: boolean;
  hasForcedResolvers: boolean;
  clientQuery: DocumentNode | null;
  serverQuery: DocumentNode | null;
  defaultVars: OperationVariables;
  asQuery: DocumentNode;
}

export class QueryManager<TStore> {
  public cache: ApolloCache<TStore>;
  public link: ApolloLink;
  public readonly assumeImmutableResults: boolean;
  public readonly ssrMode: boolean;

  private queryDeduplication: boolean;
  private clientAwareness: Record<string, string> = {};
  private localState: LocalState<TStore>;

  private onBroadcast?: () => void;
  public mutationStore?: {
    [mutationId: string]: MutationStoreValue;
  };

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
    onBroadcast,
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
    this.clientAwareness = clientAwareness;
    this.localState = localState || new LocalState({ cache });
    this.ssrMode = ssrMode;
    this.assumeImmutableResults = !!assumeImmutableResults;
    if ((this.onBroadcast = onBroadcast)) {
      this.mutationStore = Object.create(null);
    }
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

  public async mutate<
    TData,
    TVariables,
    TContext,
    TCache extends ApolloCache<any>
  >({
    mutation,
    variables,
    optimisticResponse,
    updateQueries,
    refetchQueries = [],
    awaitRefetchQueries = false,
    update: updateWithProxyFn,
    onQueryUpdated,
    errorPolicy = 'none',
    fetchPolicy,
    keepRootFields,
    context,
  }: MutationOptions<TData, TVariables, TContext>): Promise<FetchResult<TData>> {
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

    variables = this.getVariables(mutation, variables) as TVariables;

    if (this.transform(mutation).hasClientExports) {
      variables = await this.localState.addExportedVariables(mutation, variables, context) as TVariables;
    }

    const mutationStoreValue =
      this.mutationStore &&
      (this.mutationStore[mutationId] = {
        mutation,
        variables,
        loading: true,
        error: null,
      } as MutationStoreValue);

    if (optimisticResponse) {
      this.markMutationOptimistic<
        TData,
        TVariables,
        TContext,
        TCache
      >(optimisticResponse, {
        mutationId,
        document: mutation,
        variables,
        fetchPolicy,
        errorPolicy,
        context,
        updateQueries,
        update: updateWithProxyFn,
        keepRootFields,
      });
    }

    this.broadcastQueries();

    const self = this;

    return new Promise((resolve, reject) => {
      return asyncMap(
        self.getObservableFromLink(
          mutation,
          {
            ...context,
            optimisticResponse,
          },
          variables,
          false,
        ),

        (result: FetchResult<TData>) => {
          if (graphQLResultHasError(result) && errorPolicy === 'none') {
            throw new ApolloError({
              graphQLErrors: result.errors,
            });
          }

          if (mutationStoreValue) {
            mutationStoreValue.loading = false;
            mutationStoreValue.error = null;
          }

          const storeResult: typeof result = { ...result };

          if (typeof refetchQueries === "function") {
            refetchQueries = refetchQueries(storeResult);
          }

          if (errorPolicy === 'ignore' &&
              graphQLResultHasError(storeResult)) {
            delete storeResult.errors;
          }

          return self.markMutationResult<
            TData,
            TVariables,
            TContext,
            TCache
          >({
            mutationId,
            result: storeResult,
            document: mutation,
            variables,
            fetchPolicy,
            errorPolicy,
            context,
            update: updateWithProxyFn,
            updateQueries,
            awaitRefetchQueries,
            refetchQueries,
            removeOptimistic: optimisticResponse ? mutationId : void 0,
            onQueryUpdated,
            keepRootFields,
          });
        },

      ).subscribe({
        next(storeResult) {
          self.broadcastQueries();

          // At the moment, a mutation can have only one result, so we can
          // immediately resolve upon receiving the first result. In the future,
          // mutations containing @defer or @stream directives might receive
          // multiple FetchResult payloads from the ApolloLink chain, so we will
          // probably need to collect those results in this next method and call
          // resolve only later, in an observer.complete function.
          resolve(storeResult);
        },

        error(err: Error) {
          if (mutationStoreValue) {
            mutationStoreValue.loading = false;
            mutationStoreValue.error = err;
          }

          if (optimisticResponse) {
            self.cache.removeOptimistic(mutationId);
          }

          self.broadcastQueries();

          reject(
            err instanceof ApolloError ? err : new ApolloError({
              networkError: err,
            }),
          );
        },
      });
    });
  }

  public markMutationResult<
    TData,
    TVariables,
    TContext,
    TCache extends ApolloCache<any>
  >(
    mutation: {
      mutationId: string;
      result: FetchResult<TData>;
      document: DocumentNode;
      variables?: TVariables;
      fetchPolicy?: "no-cache";
      errorPolicy: ErrorPolicy;
      context?: TContext;
      updateQueries: UpdateQueries<TData>;
      update?: MutationUpdaterFunction<TData, TVariables, TContext, TCache>;
      awaitRefetchQueries?: boolean;
      refetchQueries?: InternalRefetchQueriesInclude;
      removeOptimistic?: string;
      onQueryUpdated?: OnQueryUpdated<any>;
      keepRootFields?: boolean;
    },
    cache = this.cache,
  ): Promise<FetchResult<TData>> {
    let { result } = mutation;
    const cacheWrites: Cache.WriteOptions[] = [];
    const skipCache = mutation.fetchPolicy === "no-cache";

    if (!skipCache && shouldWriteResult(result, mutation.errorPolicy)) {
      cacheWrites.push({
        result: result.data,
        dataId: 'ROOT_MUTATION',
        query: mutation.document,
        variables: mutation.variables,
      });

      const { updateQueries } = mutation;
      if (updateQueries) {
        this.queries.forEach(({ observableQuery }, queryId) => {
          const queryName = observableQuery && observableQuery.queryName;
          if (!queryName || !hasOwnProperty.call(updateQueries, queryName)) {
            return;
          }
          const updater = updateQueries[queryName];
          const { document, variables } = this.queries.get(queryId)!;

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
              mutationResult: result,
              queryName: document && getOperationName(document) || void 0,
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
    }

    if (
      cacheWrites.length > 0 ||
      mutation.refetchQueries ||
      mutation.update ||
      mutation.onQueryUpdated ||
      mutation.removeOptimistic
    ) {
      const results: any[] = [];

      this.refetchQueries({
        updateCache: (cache: TCache) => {
          if (!skipCache) {
            cacheWrites.forEach(write => cache.write(write));
          }

          // If the mutation has some writes associated with it then we need to
          // apply those writes to the store by running this reducer again with
          // a write action.
          const { update } = mutation;
          if (update) {
            if (!skipCache) {
              // Re-read the ROOT_MUTATION data we just wrote into the cache
              // (the first cache.write call in the cacheWrites.forEach loop
              // above), so field read functions have a chance to run for
              // fields within mutation result objects.
              const diff = cache.diff<TData>({
                id: "ROOT_MUTATION",
                // The cache complains if passed a mutation where it expects a
                // query, so we transform mutations and subscriptions to queries
                // (only once, thanks to this.transformCache).
                query: this.transform(mutation.document).asQuery,
                variables: mutation.variables,
                optimistic: false,
                returnPartialData: true,
              });

              if (diff.complete) {
                result = { ...result, data: diff.result };
              }
            }

            update(cache, result, {
              context: mutation.context,
              variables: mutation.variables,
            });
          }

          // TODO Do this with cache.evict({ id: 'ROOT_MUTATION' }) but make it
          // shallow to allow rolling back optimistic evictions.
          if (!skipCache && !mutation.keepRootFields) {
            cache.modify({
              id: 'ROOT_MUTATION',
              fields(value, { fieldName, DELETE }) {
                return fieldName === "__typename" ? value : DELETE;
              },
            });
          }
        },

        include: mutation.refetchQueries,

        // Write the final mutation.result to the root layer of the cache.
        optimistic: false,

        // Remove the corresponding optimistic layer at the same time as we
        // write the final non-optimistic result.
        removeOptimistic: mutation.removeOptimistic,

        // Let the caller of client.mutate optionally determine the refetching
        // behavior for watched queries after the mutation.update function runs.
        // If no onQueryUpdated function was provided for this mutation, pass
        // null instead of undefined to disable the default refetching behavior.
        onQueryUpdated: mutation.onQueryUpdated || null,

      }).forEach(result => results.push(result));

      if (mutation.awaitRefetchQueries || mutation.onQueryUpdated) {
        // Returning a promise here makes the mutation await that promise, so we
        // include results in that promise's work if awaitRefetchQueries or an
        // onQueryUpdated function was specified.
        return Promise.all(results).then(() => result);
      }
    }

    return Promise.resolve(result);
  }

  public markMutationOptimistic<TData, TVariables, TContext, TCache extends ApolloCache<any>>(
    optimisticResponse: any,
    mutation: {
      mutationId: string;
      document: DocumentNode;
      variables?: TVariables;
      fetchPolicy?: "no-cache";
      errorPolicy: ErrorPolicy;
      context?: TContext;
      updateQueries: UpdateQueries<TData>,
      update?: MutationUpdaterFunction<TData, TVariables, TContext, TCache>;
      keepRootFields?: boolean,
    },
  ) {
    const data = typeof optimisticResponse === "function"
      ? optimisticResponse(mutation.variables)
      : optimisticResponse;

    return this.cache.recordOptimisticTransaction(cache => {
      try {
        this.markMutationResult<TData, TVariables, TContext, TCache>({
          ...mutation,
          result: { data },
        }, cache);
      } catch (error) {
        invariant.error(error);
      }
    }, mutation.mutationId);
  }

  public fetchQuery<TData, TVars>(
    queryId: string,
    options: WatchQueryOptions<TVars, TData>,
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

  private transformCache = new (
    canUseWeakMap ? WeakMap : Map
  )<DocumentNode, TransformCacheEntry>();

  public transform(document: DocumentNode) {
    const { transformCache } = this;

    if (!transformCache.has(document)) {
      const transformed = this.cache.transformDocument(document);
      const forLink = removeConnectionDirectiveFromDocument(
        this.cache.transformForLink(transformed));

      const clientQuery = this.localState.clientQuery(transformed);
      const serverQuery = forLink && this.localState.serverQuery(forLink);

      const cacheEntry: TransformCacheEntry = {
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
        // Transform any mutation or subscription operations to query operations
        // so we can read/write them from/to the cache.
        asQuery: {
          ...transformed,
          definitions: transformed.definitions.map(def => {
            if (def.kind === "OperationDefinition" &&
                def.operation !== "query") {
              return { ...def, operation: "query" };
            }
            return def;
          }),
        }
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

  private getVariables<TVariables>(
    document: DocumentNode,
    variables?: TVariables,
  ): OperationVariables {
    return {
      ...this.transform(document).defaultVars,
      ...variables,
    };
  }

  public watchQuery<T, TVariables = OperationVariables>(
    options: WatchQueryOptions<TVariables, T>,
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
    options: QueryOptions<TVars, TData>,
    queryId = this.generateQueryId(),
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

    if (this.mutationStore) {
      this.mutationStore = Object.create(null);
    }

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

  public getObservableQueries(
    include: InternalRefetchQueriesInclude = "active",
  ) {
    const queries = new Map<string, ObservableQuery<any>>();
    const queryNamesAndDocs = new Map<string | DocumentNode, boolean>();
    const legacyQueryOptions = new Set<QueryOptions>();

    if (Array.isArray(include)) {
      include.forEach(desc => {
        if (typeof desc === "string") {
          queryNamesAndDocs.set(desc, false);
        } else if (isDocumentNode(desc)) {
          queryNamesAndDocs.set(this.transform(desc).document, false);
        } else if (isNonNullObject(desc) && desc.query) {
          legacyQueryOptions.add(desc);
        }
      });
    }

    this.queries.forEach(({ observableQuery: oq, document }, queryId) => {
      if (oq) {
        if (include === "all") {
          queries.set(queryId, oq);
          return;
        }

        const {
          queryName,
          options: { fetchPolicy },
        } = oq;

        if (fetchPolicy === "standby" || !oq.hasObservers()) {
          // Skip inactive queries unless include === "all".
          return;
        }

        if (
          include === "active" ||
          (queryName && queryNamesAndDocs.has(queryName)) ||
          (document && queryNamesAndDocs.has(document))
        ) {
          queries.set(queryId, oq);
          if (queryName) queryNamesAndDocs.set(queryName, true);
          if (document) queryNamesAndDocs.set(document, true);
        }
      }
    });

    if (legacyQueryOptions.size) {
      legacyQueryOptions.forEach((options: QueryOptions) => {
        // We will be issuing a fresh network request for this query, so we
        // pre-allocate a new query ID here, using a special prefix to enable
        // cleaning up these temporary queries later, after fetching.
        const queryId = makeUniqueId("legacyOneTimeQuery");
        const queryInfo = this.getQuery(queryId).init({
          document: options.query,
          variables: options.variables,
        });
        const oq = new ObservableQuery({
          queryManager: this,
          queryInfo,
          options: {
            ...options,
            fetchPolicy: "network-only",
          },
        });
        queryInfo.setObservableQuery(oq);
        queries.set(queryId, oq);
      });
    }

    if (__DEV__ && queryNamesAndDocs.size) {
      queryNamesAndDocs.forEach((included, nameOrDoc) => {
        if (!included) {
          invariant.warn(`Unknown query ${
            typeof nameOrDoc === "string" ? "named " : ""
          }${
            JSON.stringify(nameOrDoc, null, 2)
          } requested in refetchQueries options.include array`);
        }
      });
    }

    return queries;
  }

  public reFetchObservableQueries(
    includeStandby: boolean = false,
  ): Promise<ApolloQueryResult<any>[]> {
    const observableQueryPromises: Promise<ApolloQueryResult<any>>[] = [];

    this.getObservableQueries(
      includeStandby ? "all" : "active"
    ).forEach((observableQuery, queryId) => {
      const { fetchPolicy } = observableQuery.options;
      observableQuery.resetLastResults();
      if (includeStandby ||
          (fetchPolicy !== "standby" &&
           fetchPolicy !== "cache-only")) {
        observableQueryPromises.push(observableQuery.refetch());
      }
      this.getQuery(queryId).setDiff(null);
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
    errorPolicy,
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
      ).map(result => {
        if (fetchPolicy !== 'no-cache') {
          // the subscription interface should handle not sending us results we no longer subscribe to.
          // XXX I don't think we ever send in an object with errors, but we might in the future...
          if (shouldWriteResult(result, errorPolicy)) {
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
    this.getQuery(queryId).stop();
    this.queries.delete(queryId);
  }

  public broadcastQueries() {
    if (this.onBroadcast) this.onBroadcast();
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

        const varJson = canonicalStringify(variables);
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
    cacheWriteBehavior: CacheWriteBehavior,
    options: Pick<WatchQueryOptions<TVars, TData>,
      | "variables"
      | "context"
      | "fetchPolicy"
      | "errorPolicy">,
  ): Observable<ApolloQueryResult<TData>> {
    const requestId = queryInfo.lastRequestId = this.generateRequestId();

    return asyncMap(
      this.getObservableFromLink(
        queryInfo.document!,
        options.context,
        options.variables,
      ),

      result => {
        const hasErrors = isNonEmptyArray(result.errors);

        // If we interrupted this request by calling getResultsFromLink again
        // with the same QueryInfo object, we ignore the old results.
        if (requestId >= queryInfo.lastRequestId) {
          if (hasErrors && options.errorPolicy === "none") {
            // Throwing here effectively calls observer.error.
            throw queryInfo.markError(new ApolloError({
              graphQLErrors: result.errors,
            }));
          }
          queryInfo.markResult(result, options, cacheWriteBehavior);
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

        // Avoid storing errors from older interrupted queries.
        if (requestId >= queryInfo.lastRequestId) {
          queryInfo.markError(error);
        }

        throw error;
      },
    );
  }

  public fetchQueryObservable<TData, TVars>(
    queryId: string,
    options: WatchQueryOptions<TVars, TData>,
    // The initial networkStatus for this fetch, most often
    // NetworkStatus.loading, but also possibly fetchMore, poll, refetch,
    // or setVariables.
    networkStatus = NetworkStatus.loading,
  ): Concast<ApolloQueryResult<TData>> {
    const query = this.transform(options.query).document;
    const variables = this.getVariables(query, options.variables) as TVars;
    const queryInfo = this.getQuery(queryId);

    let {
      fetchPolicy = "cache-first" as WatchQueryFetchPolicy,
      errorPolicy = "none" as ErrorPolicy,
      returnPartialData = false,
      notifyOnNetworkStatusChange = false,
      context = {},
    } = options;

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
      applyNextFetchPolicy(options);
    });

    return concast;
  }

  public refetchQueries<TResult>({
    updateCache,
    include,
    optimistic = false,
    removeOptimistic = optimistic ? makeUniqueId("refetchQueries") : void 0,
    onQueryUpdated,
  }: InternalRefetchQueriesOptions<ApolloCache<TStore>, TResult>
  ): InternalRefetchQueriesMap<TResult> {
    const includedQueriesById = new Map<string, {
      oq: ObservableQuery<any>;
      lastDiff?: Cache.DiffResult<any>;
      diff?: Cache.DiffResult<any>;
    }>();

    if (include) {
      this.getObservableQueries(include).forEach((oq, queryId) => {
        includedQueriesById.set(queryId, {
          oq,
          lastDiff: this.getQuery(queryId).getDiff(),
        });
      });
    }

    const results: InternalRefetchQueriesMap<TResult> = new Map;

    if (updateCache) {
      this.cache.batch({
        update: updateCache,

        // Since you can perform any combination of cache reads and/or writes in
        // the cache.batch update function, its optimistic option can be either
        // a boolean or a string, representing three distinct modes of
        // operation:
        //
        // * false: read/write only the root layer
        // * true: read/write the topmost layer
        // * string: read/write a fresh optimistic layer with that ID string
        //
        // When typeof optimistic === "string", a new optimistic layer will be
        // temporarily created within cache.batch with that string as its ID. If
        // we then pass that same string as the removeOptimistic option, we can
        // make cache.batch immediately remove the optimistic layer after
        // running the updateCache function, triggering only one broadcast.
        //
        // However, the refetchQueries method accepts only true or false for its
        // optimistic option (not string). We interpret true to mean a temporary
        // optimistic layer should be created, to allow efficiently rolling back
        // the effect of the updateCache function, which involves passing a
        // string instead of true as the optimistic option to cache.batch, when
        // refetchQueries receives optimistic: true.
        //
        // In other words, we are deliberately not supporting the use case of
        // writing to an *existing* optimistic layer (using the refetchQueries
        // updateCache function), since that would potentially interfere with
        // other optimistic updates in progress. Instead, you can read/write
        // only the root layer by passing optimistic: false to refetchQueries,
        // or you can read/write a brand new optimistic layer that will be
        // automatically removed by passing optimistic: true.
        optimistic: optimistic && removeOptimistic || false,

        // The removeOptimistic option can also be provided by itself, even if
        // optimistic === false, to remove some previously-added optimistic
        // layer safely and efficiently, like we do in markMutationResult.
        //
        // If an explicit removeOptimistic string is provided with optimistic:
        // true, the removeOptimistic string will determine the ID of the
        // temporary optimistic layer, in case that ever matters.
        removeOptimistic,

        onWatchUpdated(watch, diff, lastDiff) {
          const oq =
            watch.watcher instanceof QueryInfo &&
            watch.watcher.observableQuery;

          if (oq) {
            if (onQueryUpdated) {
              // Since we're about to handle this query now, remove it from
              // includedQueriesById, in case it was added earlier because of
              // options.include.
              includedQueriesById.delete(oq.queryId);

              let result: boolean | InternalRefetchQueriesResult<TResult> =
                onQueryUpdated(oq, diff, lastDiff);

              if (result === true) {
                // The onQueryUpdated function requested the default refetching
                // behavior by returning true.
                result = oq.refetch();
              }

              // Record the result in the results Map, as long as onQueryUpdated
              // did not return false to skip/ignore this result.
              if (result !== false) {
                results.set(oq, result);
              }

              // Prevent the normal cache broadcast of this result, since we've
              // already handled it.
              return false;
            }

            if (onQueryUpdated !== null) {
              // If we don't have an onQueryUpdated function, and onQueryUpdated
              // was not disabled by passing null, make sure this query is
              // "included" like any other options.include-specified query.
              includedQueriesById.set(oq.queryId, { oq, lastDiff, diff });
            }
          }
        },
      });
    }

    if (includedQueriesById.size) {
      includedQueriesById.forEach(({ oq, lastDiff, diff }, queryId) => {
        let result: undefined | boolean | InternalRefetchQueriesResult<TResult>;

        // If onQueryUpdated is provided, we want to use it for all included
        // queries, even the QueryOptions ones.
        if (onQueryUpdated) {
          if (!diff) {
            const info = oq["queryInfo"];
            info.reset(); // Force info.getDiff() to read from cache.
            diff = info.getDiff();
          }
          result = onQueryUpdated(oq, diff, lastDiff);
        }

        // Otherwise, we fall back to refetching.
        if (!onQueryUpdated || result === true) {
          result = oq.refetch();
        }

        if (result !== false) {
          results.set(oq, result!);
        }

        if (queryId.indexOf("legacyOneTimeQuery") >= 0) {
          this.stopQueryNoBroadcast(queryId);
        }
      });
    }

    if (removeOptimistic) {
      // In case no updateCache callback was provided (so cache.batch was not
      // called above, and thus did not already remove the optimistic layer),
      // remove it here. Since this is a no-op when the layer has already been
      // removed, we do it even if we called cache.batch above, since it's
      // possible this.cache is an instance of some ApolloCache subclass other
      // than InMemoryCache, and does not fully support the removeOptimistic
      // option for cache.batch.
      this.cache.removeOptimistic(removeOptimistic);
    }

    return results;
  }

  private fetchQueryByPolicy<TData, TVars>(
    queryInfo: QueryInfo,
    { query,
      variables,
      fetchPolicy,
      refetchWritePolicy,
      errorPolicy,
      returnPartialData,
      context,
      notifyOnNetworkStatusChange,
    }: WatchQueryOptions<TVars, TData>,
    // The initial networkStatus for this fetch, most often
    // NetworkStatus.loading, but also possibly fetchMore, poll, refetch,
    // or setVariables.
    networkStatus: NetworkStatus,
  ): ConcastSourcesIterable<ApolloQueryResult<TData>> {
    const oldNetworkStatus = queryInfo.networkStatus;

    queryInfo.init({
      document: query,
      variables,
      networkStatus,
    });

    const readCache = () => queryInfo.getDiff(variables);

    const resultsFromCache = (
      diff: Cache.DiffResult<TData>,
      networkStatus = queryInfo.networkStatus || NetworkStatus.loading,
    ) => {
      const data = diff.result;

      if (__DEV__ &&
          isNonEmptyArray(diff.missing) &&
          !equal(data, {}) &&
          !returnPartialData) {
        invariant.debug(`Missing cache result fields: ${
          diff.missing.map(m => m.path.join('.')).join(', ')
        }`, diff.missing);
      }

      const fromData = (data: TData | undefined) => Observable.of({
        data,
        loading: isNetworkRequestInFlight(networkStatus),
        networkStatus,
        ...(diff.complete ? null : { partial: true }),
      } as ApolloQueryResult<TData>);

      if (data && this.transform(query).hasForcedResolvers) {
        return this.localState.runResolvers({
          document: query,
          remoteResult: { data },
          context,
          variables,
          onlyRunForcedResolvers: true,
        }).then(resolved => fromData(resolved.data || void 0));
      }

      return fromData(data);
    };

    const cacheWriteBehavior =
      fetchPolicy === "no-cache" ? CacheWriteBehavior.FORBID :
      ( // Watched queries must opt into overwriting existing data on refetch,
        // by passing refetchWritePolicy: "overwrite" in their WatchQueryOptions.
        networkStatus === NetworkStatus.refetch &&
        refetchWritePolicy !== "merge"
      ) ? CacheWriteBehavior.OVERWRITE
        : CacheWriteBehavior.MERGE;

    const resultsFromLink = () =>
      this.getResultsFromLink<TData, TVars>(queryInfo, cacheWriteBehavior, {
        variables,
        context,
        fetchPolicy,
        errorPolicy,
      });

    const shouldNotify =
      notifyOnNetworkStatusChange &&
      typeof oldNetworkStatus === "number" &&
      oldNetworkStatus !== networkStatus &&
      isNetworkRequestInFlight(networkStatus);

    switch (fetchPolicy) {
    default: case "cache-first": {
      const diff = readCache();

      if (diff.complete) {
        return [
          resultsFromCache(diff, queryInfo.markReady()),
        ];
      }

      if (returnPartialData || shouldNotify) {
        return [
          resultsFromCache(diff),
          resultsFromLink(),
        ];
      }

      return [
        resultsFromLink(),
      ];
    }

    case "cache-and-network": {
      const diff = readCache();

      if (diff.complete || returnPartialData || shouldNotify) {
        return [
          resultsFromCache(diff),
          resultsFromLink(),
        ];
      }

      return [
        resultsFromLink(),
      ];
    }

    case "cache-only":
      return [
        resultsFromCache(readCache(), queryInfo.markReady()),
      ];

    case "network-only":
      if (shouldNotify) {
        return [
          resultsFromCache(readCache()),
          resultsFromLink(),
        ];
      }

      return [resultsFromLink()];

    case "no-cache":
      if (shouldNotify) {
        return [
          // Note that queryInfo.getDiff() for no-cache queries does not call
          // cache.diff, but instead returns a { complete: false } stub result
          // when there is no queryInfo.diff already defined.
          resultsFromCache(queryInfo.getDiff()),
          resultsFromLink(),
        ];
      }

      return [resultsFromLink()];

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
