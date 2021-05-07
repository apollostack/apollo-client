import { invariant } from 'ts-invariant';
import { equal } from '@wry/equality';

import { NetworkStatus, isNetworkRequestInFlight } from './networkStatus';
import {
  cloneDeep,
  getOperationDefinition,
  Observable,
  Observer,
  ObservableSubscription,
  iterateObserversSafely,
  isNonEmptyArray,
  fixObservableSubclass,
} from '../utilities';
import { ApolloError } from '../errors';
import { QueryManager } from './QueryManager';
import { ApolloQueryResult, OperationVariables } from './types';
import {
  WatchQueryOptions,
  FetchMoreQueryOptions,
  SubscribeToMoreOptions,
} from './watchQueryOptions';
import { Reobserver } from './Reobserver';
import { QueryInfo } from './QueryInfo';

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

let warnedAboutUpdateQuery = false;

export class ObservableQuery<
  TData = any,
  TVariables = OperationVariables
> extends Observable<ApolloQueryResult<TData>> {
  public readonly options: WatchQueryOptions<TVariables, TData>;
  public readonly queryId: string;
  public readonly queryName?: string;

  // Computed shorthand for this.options.variables, preserved for
  // backwards compatibility.
  public get variables(): TVariables | undefined {
    return this.options.variables;
  }

  private isTornDown: boolean;
  private queryManager: QueryManager<any>;
  private observers = new Set<Observer<ApolloQueryResult<TData>>>();
  private subscriptions = new Set<ObservableSubscription>();

  private lastResult?: ApolloQueryResult<TData>;
  private lastResultSnapshot?: ApolloQueryResult<TData>;
  private lastError?: ApolloError;
  private queryInfo: QueryInfo;

  constructor({
    queryManager,
    queryInfo,
    options,
  }: {
    queryManager: QueryManager<any>;
    queryInfo: QueryInfo;
    options: WatchQueryOptions<TVariables, TData>;
  }) {
    super((observer: Observer<ApolloQueryResult<TData>>) =>
      this.onSubscribe(observer),
    );

    // active state
    this.isTornDown = false;

    // query information
    this.options = options;
    this.queryId = queryManager.generateQueryId();

    const opDef = getOperationDefinition(options.query);
    this.queryName = opDef && opDef.name && opDef.name.value;

    // related classes
    this.queryManager = queryManager;

    this.queryInfo = queryInfo;
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

  public getCurrentResult(saveAsLastResult = true): ApolloQueryResult<TData> {
    const { lastResult } = this;

    const networkStatus =
      this.queryInfo.networkStatus ||
      (lastResult && lastResult.networkStatus) ||
      NetworkStatus.ready;

    const result: ApolloQueryResult<TData> = {
      ...lastResult!,
      loading: isNetworkRequestInFlight(networkStatus),
      networkStatus,
    };

    if (this.isTornDown) {
      return result;
    }

    const { fetchPolicy = 'cache-first' } = this.options;
    if (fetchPolicy === 'no-cache' ||
        fetchPolicy === 'network-only') {
      // Similar to setting result.partial to false, but taking advantage
      // of the falsiness of missing fields.
      delete result.partial;
    } else if (
      !result.data ||
      // If this.options.query has @client(always: true) fields, we cannot
      // trust result.data, since it was read from the cache without
      // running local resolvers (and it's too late to run resolvers now,
      // since we must return a result synchronously). TODO In the future
      // (after Apollo Client 3.0), we should find a way to trust
      // this.lastResult in more cases, and read from the cache only in
      // cases when no result has been received yet.
      !this.queryManager.transform(this.options.query).hasForcedResolvers
    ) {
      const diff = this.queryInfo.getDiff();
      result.data = (
        diff.complete ||
        this.options.returnPartialData
      ) ? diff.result : void 0;
      if (diff.complete) {
        // If the diff is complete, and we're using a FetchPolicy that
        // terminates after a complete cache read, we can assume the next
        // result we receive will have NetworkStatus.ready and !loading.
        if (result.networkStatus === NetworkStatus.loading &&
            (fetchPolicy === 'cache-first' ||
             fetchPolicy === 'cache-only')) {
          result.networkStatus = NetworkStatus.ready;
          result.loading = false;
        }
        delete result.partial;
      } else {
        result.partial = true;
      }
    }

    if (saveAsLastResult) {
      this.updateLastResult(result);
    }

    return result;
  }

  // Compares newResult to the snapshot we took of this.lastResult when it was
  // first received.
  public isDifferentFromLastResult(newResult: ApolloQueryResult<TData>) {
    return !equal(this.lastResultSnapshot, newResult);
  }

  // Returns the last result that observer.next was called with. This is not the same as
  // getCurrentResult! If you're not sure which you need, then you probably need getCurrentResult.
  public getLastResult(): ApolloQueryResult<TData> {
    return this.lastResult!;
  }

  public getLastError(): ApolloError {
    return this.lastError!;
  }

  public resetLastResults(): void {
    delete this.lastResult;
    delete this.lastResultSnapshot;
    delete this.lastError;
    this.isTornDown = false;
  }

  public resetQueryStoreErrors() {
    this.queryManager.resetErrors(this.queryId);
  }

  /**
   * Update the variables of this observable query, and fetch the new results.
   * This method should be preferred over `setVariables` in most use cases.
   *
   * @param variables: The new set of variables. If there are missing variables,
   * the previous values of those variables will be used.
   */
  public refetch(variables?: Partial<TVariables>): Promise<ApolloQueryResult<TData>> {
    const reobserveOptions: Partial<WatchQueryOptions<TVariables, TData>> = {
      // Always disable polling for refetches.
      pollInterval: 0,
    };

    // Unless the provided fetchPolicy always consults the network
    // (no-cache, network-only, or cache-and-network), override it with
    // network-only to force the refetch for this fetchQuery call.
    const { fetchPolicy } = this.options;
    if (fetchPolicy !== 'no-cache' &&
        fetchPolicy !== 'cache-and-network') {
      reobserveOptions.fetchPolicy = 'network-only';
      // Go back to the original options.fetchPolicy after this refetch.
      reobserveOptions.nextFetchPolicy = fetchPolicy || "cache-first";
    }

    if (variables && !equal(this.options.variables, variables)) {
      // Update the existing options with new variables
      reobserveOptions.variables = this.options.variables = {
        ...this.options.variables,
        ...variables,
      } as TVariables;
    }

    return this.newReobserver(false).reobserve(
      reobserveOptions,
      NetworkStatus.refetch,
    );
  }

  public fetchMore<K extends keyof TVariables>(
    fetchMoreOptions: FetchMoreQueryOptions<TVariables, K, TData> &
      FetchMoreOptions<TData, TVariables>,
  ): Promise<ApolloQueryResult<TData>> {
    const combinedOptions = {
      ...(fetchMoreOptions.query ? fetchMoreOptions : {
        ...this.options,
        ...fetchMoreOptions,
        variables: {
          ...this.options.variables,
          ...fetchMoreOptions.variables,
        },
      }),
      // The fetchMore request goes immediately to the network and does
      // not automatically write its result to the cache (hence no-cache
      // instead of network-only), because we allow the caller of
      // fetchMore to provide an updateQuery callback that determines how
      // the data gets written to the cache.
      fetchPolicy: "no-cache",
    } as WatchQueryOptions;

    const qid = this.queryManager.generateQueryId();

    // Simulate a loading result for the original query with
    // result.networkStatus === NetworkStatus.fetchMore.
    if (combinedOptions.notifyOnNetworkStatusChange) {
      this.queryInfo.networkStatus = NetworkStatus.fetchMore;
      this.observe();
    }

    return this.queryManager.fetchQuery(
      qid,
      combinedOptions,
      NetworkStatus.fetchMore,
    ).then(fetchMoreResult => {
      const data = fetchMoreResult.data as TData;
      const { updateQuery } = fetchMoreOptions;

      if (updateQuery) {
        if (process.env.NODE_ENV !== "production" &&
            !warnedAboutUpdateQuery) {
          invariant.warn(
`The updateQuery callback for fetchMore is deprecated, and will be removed
in the next major version of Apollo Client.

Please convert updateQuery functions to field policies with appropriate
read and merge functions, or use/adapt a helper function (such as
concatPagination, offsetLimitPagination, or relayStylePagination) from
@apollo/client/utilities.

The field policy system handles pagination more effectively than a
hand-written updateQuery function, and you only need to define the policy
once, rather than every time you call fetchMore.`);
          warnedAboutUpdateQuery = true;
        }
        this.updateQuery(previous => updateQuery(previous, {
          fetchMoreResult: data,
          variables: combinedOptions.variables as TVariables,
        }));
      } else {
        // If we're using a field policy instead of updateQuery, the only
        // thing we need to do is write the new data to the cache using
        // combinedOptions.variables (instead of this.variables, which is
        // what this.updateQuery uses, because it works by abusing the
        // original field value, keyed by the original variables).
        this.queryManager.cache.writeQuery({
          query: combinedOptions.query,
          variables: combinedOptions.variables,
          data,
        });
      }

      return fetchMoreResult as ApolloQueryResult<TData>;

    }).finally(() => {
      this.queryManager.stopQuery(qid);
      this.reobserve();
    });
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
        context: options.context,
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

  public setOptions(
    newOptions: Partial<WatchQueryOptions<TVariables, TData>>,
  ): Promise<ApolloQueryResult<TData>> {
    return this.reobserve(newOptions);
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
   */
  public setVariables(
    variables: TVariables,
  ): Promise<ApolloQueryResult<TData> | void> {
    if (equal(this.variables, variables)) {
      // If we have no observers, then we don't actually want to make a network
      // request. As soon as someone observes the query, the request will kick
      // off. For now, we just store any changes. (See #1077)
      return this.observers.size
        ? this.result()
        : Promise.resolve();
    }

    this.options.variables = variables;

    // See comment above
    if (!this.observers.size) {
      return Promise.resolve();
    }

    let { fetchPolicy = 'cache-first' } = this.options;
    const reobserveOptions: Partial<WatchQueryOptions<TVariables, TData>> = {
      fetchPolicy,
      variables,
    };

    if (fetchPolicy !== 'cache-first' &&
        fetchPolicy !== 'no-cache' &&
        fetchPolicy !== 'network-only') {
      reobserveOptions.fetchPolicy = 'cache-and-network';
      reobserveOptions.nextFetchPolicy = fetchPolicy;
    }

    return this.reobserve(
      reobserveOptions,
      NetworkStatus.setVariables,
    );
  }

  public updateQuery<TVars = TVariables>(
    mapFn: (
      previousQueryResult: TData,
      options: Pick<WatchQueryOptions<TVars, TData>, "variables">,
    ) => TData,
  ): void {
    const { queryManager } = this;
    const { result } = queryManager.cache.diff<TData>({
      query: this.options.query,
      variables: this.variables,
      previousResult: this.lastResult?.data,
      returnPartialData: true,
      optimistic: false,
    });

    const newResult = mapFn(result!, {
      variables: (this as any).variables,
    });

    if (newResult) {
      queryManager.cache.writeQuery({
        query: this.options.query,
        data: newResult,
        variables: this.variables,
      });

      queryManager.broadcastQueries();
    }
  }

  public startPolling(pollInterval: number) {
    this.getReobserver().updateOptions({ pollInterval });
  }

  public stopPolling() {
    if (this.reobserver) {
      this.reobserver.updateOptions({ pollInterval: 0 });
    }
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
    // Subscribing using this.observer will create an infinite notificaion
    // loop, but the intent of broadcasting results to all the other
    // this.observers can be satisfied without doing anything, which is
    // why we do not bother throwing an error here.
    if (observer === this.observer) {
      return () => {};
    }

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

    // Deliver most recent error or result.
    if (this.lastError) {
      observer.error && observer.error(this.lastError);
    } else if (this.lastResult) {
      observer.next && observer.next(this.lastResult);
    }

    // Initiate observation of this query if it hasn't been reported to
    // the QueryManager yet.
    if (first) {
      this.reobserve().catch(_ => {
        // Blindly catching here prevents unhandled promise rejections,
        // and is safe because the ObservableQuery handles this error with
        // this.observer.error, so we're not just swallowing the error by
        // ignoring it here.
      });
    }

    return () => {
      if (this.observers.delete(observer) && !this.observers.size) {
        this.tearDownQuery();
      }
    };
  }

  private reobserver?: Reobserver<TData, TVariables>;

  private getReobserver(): Reobserver<TData, TVariables> {
    return this.reobserver || (this.reobserver = this.newReobserver(true));
  }

  private newReobserver(shareOptions: boolean) {
    const { queryManager, queryId } = this;
    queryManager.setObservableQuery(this);
    return new Reobserver<TData, TVariables>(
      this.observer,
      // Sharing options allows this.reobserver.options to be ===
      // this.options, so we don't have to worry about synchronizing the
      // properties of two distinct objects.
      shareOptions ? this.options : { ...this.options },
      (currentOptions, newNetworkStatus) => {
        queryManager.setObservableQuery(this);
        return queryManager.fetchQueryObservable(
          queryId,
          currentOptions,
          newNetworkStatus,
        );
      },
      // Avoid polling during SSR and when the query is already in flight.
      !queryManager.ssrMode && (
        () => !isNetworkRequestInFlight(this.queryInfo.networkStatus))
    );
  }

  public reobserve(
    newOptions?: Partial<WatchQueryOptions<TVariables, TData>>,
    newNetworkStatus?: NetworkStatus,
  ): Promise<ApolloQueryResult<TData>> {
    this.isTornDown = false;
    return this.getReobserver().reobserve(newOptions, newNetworkStatus);
  }

  // Pass the current result to this.observer.next without applying any
  // fetch policies, bypassing the Reobserver.
  private observe() {
    // Passing false is important so that this.getCurrentResult doesn't
    // save the fetchMore result as this.lastResult, causing it to be
    // ignored due to the this.isDifferentFromLastResult check in
    // this.observer.next.
    this.observer.next(this.getCurrentResult(false));
  }

  private observer = {
    next: (result: ApolloQueryResult<TData>) => {
      if (this.lastError || this.isDifferentFromLastResult(result)) {
        this.updateLastResult(result);
        iterateObserversSafely(this.observers, 'next', result);
      }
    },

    error: (error: ApolloError) => {
      // Since we don't get the current result on errors, only the error, we
      // must mirror the updates that occur in QueryStore.markQueryError here
      this.updateLastResult({
        ...this.lastResult!,
        error,
        errors: error.graphQLErrors,
        networkStatus: NetworkStatus.error,
        loading: false,
      });

      iterateObserversSafely(this.observers, 'error', this.lastError = error);
    },
  };

  public hasObservers() {
    return this.observers.size > 0;
  }

  private tearDownQuery() {
    if (this.isTornDown) return;

    if (this.reobserver) {
      this.reobserver.stop();
      delete this.reobserver;
    }

    // stop all active GraphQL subscriptions
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions.clear();

    this.queryManager.stopQuery(this.queryId);

    this.observers.clear();

    this.isTornDown = true;
  }
}

// Necessary because the ObservableQuery constructor has a different
// signature than the Observable constructor.
fixObservableSubclass(ObservableQuery);

function defaultSubscriptionObserverErrorCallback(error: ApolloError) {
  invariant.error('Unhandled error', error.message, error.stack);
}
