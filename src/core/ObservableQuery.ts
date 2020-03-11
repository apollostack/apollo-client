import { invariant, InvariantError } from 'ts-invariant';
import { equal } from '@wry/equality';

import { tryFunctionOrLogError } from '../utilities/common/errorHandling';
import { cloneDeep } from '../utilities/common/cloneDeep';
import { getOperationDefinition } from '../utilities/graphql/getFromAST';
import { NetworkStatus, isNetworkRequestInFlight } from './networkStatus';
import {
  Observable,
  Observer,
  ObservableSubscription
} from '../utilities/observables/Observable';
import { ApolloError } from '../errors/ApolloError';
import { QueryManager } from './QueryManager';
import { ApolloQueryResult, FetchType, OperationVariables } from './types';
import {
  WatchQueryOptions,
  FetchMoreQueryOptions,
  SubscribeToMoreOptions,
  ErrorPolicy,
} from './watchQueryOptions';
import { QueryStoreValue } from '../data/queries';
import { isNonEmptyArray } from '../utilities/common/arrays';

export type ApolloCurrentQueryResult<T> = ApolloQueryResult<T> & {
  error?: ApolloError;
  partial?: boolean;
};

export interface FetchMoreOptions<
  TData = any,
  TVariables = OperationVariables
> {
  updateQuery?: (
    previousQueryResult: TData,
    options: {
      fetchMoreResult?: TData;
      variables?: TVariables;
    },
  ) => TData;
}

export interface UpdateQueryOptions<TVariables> {
  variables?: TVariables;
}

export const hasError = (
  storeValue: QueryStoreValue,
  policy: ErrorPolicy = 'none',
) => storeValue && (
  storeValue.networkError ||
  (policy === 'none' && isNonEmptyArray(storeValue.graphQLErrors))
);

export class ObservableQuery<
  TData = any,
  TVariables = OperationVariables
> extends Observable<ApolloQueryResult<TData>> {
  public options: WatchQueryOptions<TVariables>;
  public readonly queryId: string;
  public readonly queryName?: string;
  /**
   *
   * The current value of the variables for this query. Can change.
   */
  public variables: TVariables;

  private shouldSubscribe: boolean;
  private isTornDown: boolean;
  private queryManager: QueryManager<any>;
  private observers = new Set<Observer<ApolloQueryResult<TData>>>();
  private subscriptions = new Set<ObservableSubscription>();

  private lastResult: ApolloQueryResult<TData>;
  private lastResultSnapshot: ApolloQueryResult<TData>;
  private lastError: ApolloError;

  constructor({
    queryManager,
    options,
    shouldSubscribe = true,
  }: {
    queryManager: QueryManager<any>;
    options: WatchQueryOptions<TVariables>;
    shouldSubscribe?: boolean;
  }) {
    super((observer: Observer<ApolloQueryResult<TData>>) =>
      this.onSubscribe(observer),
    );

    // active state
    this.isTornDown = false;

    // query information
    this.options = options;
    this.variables = options.variables || ({} as TVariables);
    this.queryId = queryManager.generateQueryId();
    this.shouldSubscribe = shouldSubscribe;

    const opDef = getOperationDefinition(options.query);
    this.queryName = opDef && opDef.name && opDef.name.value;

    // related classes
    this.queryManager = queryManager;
  }

  public result(): Promise<ApolloQueryResult<TData>> {
    return new Promise((resolve, reject) => {
      const observer: Observer<ApolloQueryResult<TData>> = {
        next: (result: ApolloQueryResult<TData>) => {
          resolve(result);

          // Stop the query within the QueryManager if we can before
          // this function returns.
          //
          // We do this in order to prevent observers piling up within
          // the QueryManager. Notice that we only fully unsubscribe
          // from the subscription in a setTimeout(..., 0)  call. This call can
          // actually be handled by the browser at a much later time. If queries
          // are fired in the meantime, observers that should have been removed
          // from the QueryManager will continue to fire, causing an unnecessary
          // performance hit.
          this.observers.delete(observer);
          if (!this.observers.size) {
            this.queryManager.removeQuery(this.queryId);
          }

          setTimeout(() => {
            subscription.unsubscribe();
          }, 0);
        },
        error: reject,
      };
      const subscription = this.subscribe(observer);
    });
  }

  public getCurrentResult(): ApolloCurrentQueryResult<TData> {
    const {
      lastResult,
      lastError,
      options: { fetchPolicy },
    } = this;

    const isNetworkFetchPolicy =
      fetchPolicy === 'network-only' ||
      fetchPolicy === 'no-cache';

    const networkStatus =
      lastError ? NetworkStatus.error :
      lastResult ? lastResult.networkStatus :
      isNetworkFetchPolicy ? NetworkStatus.loading :
      NetworkStatus.ready;

    const result: ApolloCurrentQueryResult<TData> = {
      data: !lastError && lastResult && lastResult.data || void 0,
      error: lastError,
      loading: isNetworkRequestInFlight(networkStatus),
      networkStatus,
      stale: lastResult ? lastResult.stale : false,
    };

    if (this.isTornDown) {
      return result;
    }

    const { data, partial } = this.queryManager.getCurrentQueryResult(this);
    Object.assign(result, { data, partial });

    const queryStoreValue = this.queryManager.queryStore.get(this.queryId);
    if (queryStoreValue) {
      const { networkStatus } = queryStoreValue;

      if (hasError(queryStoreValue, this.options.errorPolicy)) {
        return Object.assign(result, {
          data: void 0,
          networkStatus,
          error: new ApolloError({
            graphQLErrors: queryStoreValue.graphQLErrors,
            networkError: queryStoreValue.networkError,
          }),
        });
      }

      // Variables might have been added dynamically at query time, when
      // using `@client @export(as: "varname")` for example. When this happens,
      // the variables have been updated in the query store, but not updated on
      // the original `ObservableQuery`. We'll update the observable query
      // variables here to match, so retrieving from the cache doesn't fail.
      if (queryStoreValue.variables) {
        this.variables = this.options.variables = {
          ...this.options.variables,
          ...(queryStoreValue.variables as TVariables),
        };
      }

      Object.assign(result, {
        loading: isNetworkRequestInFlight(networkStatus),
        networkStatus,
      });

      if (queryStoreValue.graphQLErrors && this.options.errorPolicy === 'all') {
        result.errors = queryStoreValue.graphQLErrors;
      }
    }

    if (!partial) {
      result.stale = false;
      this.updateLastResult(result);
    }

    return result;
  }

  // Compares newResult to the snapshot we took of this.lastResult when it was
  // first received.
  public isDifferentFromLastResult(newResult: ApolloQueryResult<TData>) {
    const { lastResultSnapshot: snapshot } = this;
    return !(
      snapshot &&
      newResult &&
      snapshot.networkStatus === newResult.networkStatus &&
      snapshot.stale === newResult.stale &&
      equal(snapshot.data, newResult.data)
    );
  }

  // Returns the last result that observer.next was called with. This is not the same as
  // getCurrentResult! If you're not sure which you need, then you probably need getCurrentResult.
  public getLastResult(): ApolloQueryResult<TData> {
    return this.lastResult;
  }

  public getLastError(): ApolloError {
    return this.lastError;
  }

  public resetLastResults(): void {
    delete this.lastResult;
    delete this.lastResultSnapshot;
    delete this.lastError;
    this.isTornDown = false;
  }

  public resetQueryStoreErrors() {
    const queryStore = this.queryManager.queryStore.get(this.queryId);
    if (queryStore) {
      queryStore.networkError = null;
      queryStore.graphQLErrors = [];
    }
  }

  /**
   * Update the variables of this observable query, and fetch the new results.
   * This method should be preferred over `setVariables` in most use cases.
   *
   * @param variables: The new set of variables. If there are missing variables,
   * the previous values of those variables will be used.
   */
  public refetch(variables?: TVariables): Promise<ApolloQueryResult<TData>> {
    let { fetchPolicy } = this.options;
    // early return if trying to read from cache during refetch
    if (fetchPolicy === 'cache-only') {
      return Promise.reject(new InvariantError(
        'cache-only fetchPolicy option should not be used together with query refetch.',
      ));
    }

    // Unless the provided fetchPolicy always consults the network
    // (no-cache, network-only, or cache-and-network), override it with
    // network-only to force the refetch for this fetchQuery call.
    if (fetchPolicy !== 'no-cache' &&
        fetchPolicy !== 'cache-and-network') {
      fetchPolicy = 'network-only';
    }

    if (!equal(this.variables, variables)) {
      // update observable variables
      this.variables = {
        ...this.variables,
        ...variables,
      };
    }

    if (!equal(this.options.variables, this.variables)) {
      // Update the existing options with new variables
      this.options.variables = {
        ...this.options.variables,
        ...this.variables,
      };
    }

    return this.queryManager.fetchQuery(
      this.queryId,
      { ...this.options, fetchPolicy },
      FetchType.refetch,
    ) as Promise<ApolloQueryResult<TData>>;
  }

  public fetchMore<K extends keyof TVariables>(
    fetchMoreOptions: FetchMoreQueryOptions<TVariables, K> &
      FetchMoreOptions<TData, TVariables>,
  ): Promise<ApolloQueryResult<TData>> {
    const { fetchPolicy } = this.options;
    const combinedOptions = {
      ...(fetchMoreOptions.query ? fetchMoreOptions : {
        ...this.options,
        ...fetchMoreOptions,
        variables: {
          ...this.variables,
          ...fetchMoreOptions.variables,
        },
      }),
      fetchPolicy: fetchPolicy === 'no-cache' ? 'no-cache' : 'network-only',
    } as WatchQueryOptions;

    const qid = this.queryManager.generateQueryId();

    return this.queryManager
      .fetchQuery(
        qid,
        combinedOptions,
        FetchType.normal,
        this.queryId,
      )
      .then(
        fetchMoreResult => {
          this.updateQuery((previousResult: any) => {
            const data = fetchMoreResult.data as TData;
            const { updateQuery } = fetchMoreOptions;
            return updateQuery ? updateQuery(previousResult, {
              fetchMoreResult: data,
              variables: combinedOptions.variables as TVariables,
            }) : data;
          }, fetchPolicy === 'no-cache');
          this.queryManager.stopQuery(qid);
          return fetchMoreResult as ApolloQueryResult<TData>;
        },
        error => {
          this.queryManager.stopQuery(qid);
          throw error;
        },
      );
  }

  // XXX the subscription variables are separate from the query variables.
  // if you want to update subscription variables, right now you have to do that separately,
  // and you can only do it by stopping the subscription and then subscribing again with new variables.
  public subscribeToMore<
    TSubscriptionData = TData,
    TSubscriptionVariables = TVariables
  >(
    options: SubscribeToMoreOptions<
      TData,
      TSubscriptionVariables,
      TSubscriptionData
    >,
  ) {
    const subscription = this.queryManager
      .startGraphQLSubscription({
        query: options.document,
        variables: options.variables,
      })
      .subscribe({
        next: (subscriptionData: { data: TSubscriptionData }) => {
          const { updateQuery } = options;
          if (updateQuery) {
            this.updateQuery<TSubscriptionVariables>(
              (previous, { variables }) =>
                updateQuery(previous, {
                  subscriptionData,
                  variables,
                }),
            );
          }
        },
        error: (err: any) => {
          if (options.onError) {
            options.onError(err);
            return;
          }
          invariant.error('Unhandled GraphQL subscription error', err);
        },
      });

    this.subscriptions.add(subscription);

    return () => {
      if (this.subscriptions.delete(subscription)) {
        subscription.unsubscribe();
      }
    };
  }

  // Note: if the query is not active (there are no subscribers), the promise
  // will return null immediately.
  public setOptions(
    opts: WatchQueryOptions,
  ): Promise<ApolloQueryResult<TData> | void> {
    const { fetchPolicy: oldFetchPolicy } = this.options;
    this.options = {
      ...this.options,
      ...opts,
    } as WatchQueryOptions<TVariables>;

    if (opts.pollInterval) {
      this.startPolling(opts.pollInterval);
    } else if (opts.pollInterval === 0) {
      this.stopPolling();
    }

    const { fetchPolicy } = opts;

    return this.setVariables(
      this.options.variables as TVariables,
      // Try to fetch the query if fetchPolicy changed from either cache-only
      // or standby to something else, or changed to network-only.
      oldFetchPolicy !== fetchPolicy && (
        oldFetchPolicy === 'cache-only' ||
        oldFetchPolicy === 'standby' ||
        fetchPolicy === 'network-only'
      ),
      opts.fetchResults,
    );
  }

  /**
   * This is for *internal* use only. Most users should instead use `refetch`
   * in order to be properly notified of results even when they come from cache.
   *
   * Update the variables of this observable query, and fetch the new results
   * if they've changed. If you want to force new results, use `refetch`.
   *
   * Note: the `next` callback will *not* fire if the variables have not changed
   * or if the result is coming from cache.
   *
   * Note: the promise will return the old results immediately if the variables
   * have not changed.
   *
   * Note: the promise will return null immediately if the query is not active
   * (there are no subscribers).
   *
   * @private
   *
   * @param variables: The new set of variables. If there are missing variables,
   * the previous values of those variables will be used.
   *
   * @param tryFetch: Try and fetch new results even if the variables haven't
   * changed (we may still just hit the store, but if there's nothing in there
   * this will refetch)
   *
   * @param fetchResults: Option to ignore fetching results when updating variables
   */
  public setVariables(
    variables: TVariables,
    tryFetch: boolean = false,
    fetchResults = true,
  ): Promise<ApolloQueryResult<TData> | void> {
    // since setVariables restarts the subscription, we reset the tornDown status
    this.isTornDown = false;

    variables = variables || this.variables;

    if (!tryFetch && equal(variables, this.variables)) {
      // If we have no observers, then we don't actually want to make a network
      // request. As soon as someone observes the query, the request will kick
      // off. For now, we just store any changes. (See #1077)
      return this.observers.size && fetchResults
        ? this.result()
        : Promise.resolve();
    }

    this.variables = this.options.variables = variables;

    // See comment above
    if (!this.observers.size) {
      return Promise.resolve();
    }

    // Use the same options as before, but with new variables
    return this.queryManager.fetchQuery(
      this.queryId,
      this.options,
    ) as Promise<ApolloQueryResult<TData>>;
  }

  public updateQuery<TVars = TVariables>(
    mapFn: (
      previousQueryResult: TData,
      options: UpdateQueryOptions<TVars>,
    ) => TData,
    noCache: boolean = false,
  ): void {
    const { queryManager } = this;
    const {
      previousResult,
      variables,
      document,
    } = queryManager.getQueryWithPreviousResult<TData, TVars>(
      this.queryId,
    );

    const newResult = tryFunctionOrLogError(() =>
      mapFn(previousResult, { variables }),
    );

    if (newResult) {
      if (noCache) {
        queryManager.setQuery(this.queryId, () => ({
          newData: { result: newResult, complete: true },
          invalidated: true,
        }));
      } else {
        queryManager.cache.write({
            query: document,
            result: newResult,
            dataId: 'ROOT_QUERY',
            variables: variables,
        });
      }

      queryManager.broadcastQueries();
    }
  }

  public stopPolling() {
    this.queryManager.stopPollingQuery(this.queryId);
    this.options.pollInterval = undefined;
  }

  public startPolling(pollInterval: number) {
    assertNotCacheFirstOrOnly(this);
    this.options.pollInterval = pollInterval;
    this.queryManager.startPollingQuery(this.options, this.queryId);
  }

  private updateLastResult(newResult: ApolloQueryResult<TData>) {
    const previousResult = this.lastResult;
    this.lastResult = newResult;
    this.lastResultSnapshot = this.queryManager.assumeImmutableResults
      ? newResult
      : cloneDeep(newResult);
    if (!isNonEmptyArray(newResult.errors)) {
      delete this.lastError;
    }
    return previousResult;
  }

  private onSubscribe(observer: Observer<ApolloQueryResult<TData>>) {
    // Zen Observable has its own error function, so in order to log correctly
    // we need to provide a custom error callback.
    try {
      var subObserver = (observer as any)._subscription._observer;
      if (subObserver && !subObserver.error) {
        subObserver.error = defaultSubscriptionObserverErrorCallback;
      }
    } catch {}

    const first = !this.observers.size;
    this.observers.add(observer);

    // Deliver initial result
    if (observer.next && this.lastResult) observer.next(this.lastResult);
    if (observer.error && this.lastError) observer.error(this.lastError);

    // setup the query if it hasn't been done before
    if (first) {
      this.setUpQuery();
    }

    return () => {
      if (this.observers.delete(observer) && !this.observers.size) {
        this.tearDownQuery();
      }
    };
  }

  private setUpQuery() {
    const { queryManager, queryId } = this;

    if (this.shouldSubscribe) {
      queryManager.addObservableQuery<TData>(queryId, this);
    }

    if (this.options.pollInterval) {
      assertNotCacheFirstOrOnly(this);
      queryManager.startPollingQuery(this.options, queryId);
    }

    const onError = (error: ApolloError) => {
      // Since we don't get the current result on errors, only the error, we
      // must mirror the updates that occur in QueryStore.markQueryError here
      this.updateLastResult({
        ...this.lastResult,
        errors: error.graphQLErrors,
        networkStatus: NetworkStatus.error,
        loading: false,
      });
      iterateObserversSafely(this.observers, 'error', this.lastError = error);
    };

    const { hasClientExports } = queryManager.transform(this.options.query);

    queryManager.observeQuery<TData>(queryId, this.options, {
      next: (result: ApolloQueryResult<TData>) => {
        if (this.lastError || this.isDifferentFromLastResult(result)) {
          const previousResult = this.updateLastResult(result);

          const { query, variables, fetchPolicy } = this.options;

          // Before calling `next` on each observer, we need to first see if
          // the query is using `@client @export` directives, and update
          // any variables that might have changed. If `@export` variables have
          // changed, `setVariables` is used to query the cache first, followed
          // by the network if needed.
          if (hasClientExports) {
            queryManager.getLocalState().addExportedVariables(
              query,
              variables,
            ).then((variables: TVariables) => {
              const previousVariables = this.variables;
              if (
                !result.loading &&
                previousResult &&
                fetchPolicy !== 'cache-only' &&
                !equal(previousVariables, variables)
              ) {
                this.setVariables(variables).then(updatedResult => {
                  iterateObserversSafely(this.observers, 'next', updatedResult);
                });
              } else {
                this.variables = this.options.variables = variables;
                iterateObserversSafely(this.observers, 'next', result);
              }
            });
          } else {
            iterateObserversSafely(this.observers, 'next', result);
          }
        }
      },
      error: onError,
    }).catch(onError);
  }

  private tearDownQuery() {
    const { queryManager } = this;

    this.isTornDown = true;
    queryManager.stopPollingQuery(this.queryId);

    // stop all active GraphQL subscriptions
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions.clear();

    queryManager.removeObservableQuery(this.queryId);
    queryManager.stopQuery(this.queryId);

    this.observers.clear();
  }
}

function defaultSubscriptionObserverErrorCallback(error: ApolloError) {
  invariant.error('Unhandled error', error.message, error.stack);
}

function iterateObserversSafely<E, A>(
  observers: Set<Observer<E>>,
  method: keyof Observer<E>,
  argument?: A,
) {
  // In case observers is modified during iteration, we need to commit to the
  // original elements, which also provides an opportunity to filter them down
  // to just the observers with the given method.
  const observersWithMethod: Observer<E>[] = [];
  observers.forEach(obs => obs[method] && observersWithMethod.push(obs));
  observersWithMethod.forEach(obs => (obs as any)[method](argument));
}

function assertNotCacheFirstOrOnly<TData, TVariables>(
  obsQuery: ObservableQuery<TData, TVariables>,
) {
  const { fetchPolicy } = obsQuery.options;
  invariant(
    fetchPolicy !== 'cache-first' && fetchPolicy !== 'cache-only',
    'Queries that specify the cache-first and cache-only fetchPolicies cannot also be polling queries.',
  );
}
