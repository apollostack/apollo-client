import { invariant } from 'ts-invariant';
import { equal } from '@wry/equality';

import { NetworkStatus, isNetworkRequestInFlight } from './networkStatus';
import {
  Concast,
  compact,
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
  WatchQueryFetchPolicy,
} from './watchQueryOptions';
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

  // Original value of this.options.fetchPolicy (defaulting to "cache-first"),
  // from whenever the ObservableQuery was first created.
  private initialFetchPolicy: WatchQueryFetchPolicy;

  private isTornDown: boolean;
  private queryManager: QueryManager<any>;
  private observers = new Set<Observer<ApolloQueryResult<TData>>>();
  private subscriptions = new Set<ObservableSubscription>();

  private lastResult: ApolloQueryResult<TData> | undefined;
  private lastResultSnapshot: ApolloQueryResult<TData> | undefined;
  private lastError: ApolloError | undefined;
  private queryInfo: QueryInfo;

  private concast?: Concast<ApolloQueryResult<TData>>;
  private pollingInfo?: {
    interval: number;
    timeout: ReturnType<typeof setTimeout>;
  };

  constructor({
    queryManager,
    queryInfo,
    options,
  }: {
    queryManager: QueryManager<any>;
    queryInfo: QueryInfo;
    options: WatchQueryOptions<TVariables, TData>;
  }) {
    super((observer: Observer<ApolloQueryResult<TData>>) => {
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
        // Blindly catching here prevents unhandled promise rejections,
        // and is safe because the ObservableQuery handles this error with
        // this.observer.error, so we're not just swallowing the error by
        // ignoring it here.
        this.reobserve().catch(() => {});
      }

      return () => {
        if (this.observers.delete(observer) && !this.observers.size) {
          this.tearDownQuery();
        }
      };
    });

    // active state
    this.isTornDown = false;

    // query information
    this.options = options;
    this.queryId = queryManager.generateQueryId();

    const opDef = getOperationDefinition(options.query);
    this.queryName = opDef && opDef.name && opDef.name.value;

    this.initialFetchPolicy = options.fetchPolicy || "cache-first";

    // related classes
    this.queryManager = queryManager;
    this.queryInfo = queryInfo;
  }

  public result(): Promise<ApolloQueryResult<TData>> {
    return new Promise((resolve, reject) => {
      // TODO: this code doesn’t actually make sense insofar as the observer
      // will never exist in this.observers due how zen-observable wraps observables.
      // https://github.com/zenparsing/zen-observable/blob/master/src/Observable.js#L169
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
    const {
      lastResult,
      options: {
        fetchPolicy = "cache-first",
      },
    } = this;

    const networkStatus =
      this.queryInfo.networkStatus ||
      (lastResult && lastResult.networkStatus) ||
      NetworkStatus.ready;

    const result = {
      ...lastResult,
      loading: isNetworkRequestInFlight(networkStatus),
      networkStatus,
    } as ApolloQueryResult<TData>;

    // If this.options.query has @client(always: true) fields, we cannot trust
    // diff.result, since it was read from the cache without running local
    // resolvers (and it's too late to run resolvers now, since we must return a
    // result synchronously).
    if (!this.queryManager.transform(this.options.query).hasForcedResolvers) {
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
      } else if (fetchPolicy !== "no-cache") {
        // Since result.partial comes from diff.complete, and we shouldn't be
        // using cache data to provide a DiffResult when the fetchPolicy is
        // "no-cache", avoid annotating result.partial for "no-cache" results.
        result.partial = true;
      }

      if (
        !diff.complete &&
        !this.options.partialRefetch &&
        !result.loading &&
        !result.data &&
        !result.error
      ) {
        result.error = new ApolloError({ clientErrors: diff.missing });
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
  public getLastResult(): ApolloQueryResult<TData> | undefined {
    return this.lastResult;
  }

  public getLastError(): ApolloError | undefined {
    return this.lastError;
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
    if (fetchPolicy === 'no-cache') {
      reobserveOptions.fetchPolicy = 'no-cache';
    } else if (fetchPolicy !== 'cache-and-network') {
      reobserveOptions.fetchPolicy = 'network-only';
    }

    if (variables && !equal(this.options.variables, variables)) {
      // Update the existing options with new variables
      reobserveOptions.variables = this.options.variables = {
        ...this.options.variables,
        ...variables,
      } as TVariables;
    }

    this.queryInfo.resetLastWrite();
    return this.reobserve(reobserveOptions, NetworkStatus.refetch);
  }

  public fetchMore(
    fetchMoreOptions: FetchMoreQueryOptions<TVariables, TData> &
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
        if (__DEV__ &&
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

    return this.reobserve({
      // Reset options.fetchPolicy to its original value.
      fetchPolicy: this.initialFetchPolicy,
      variables,
    }, NetworkStatus.setVariables);
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
    this.options.pollInterval = pollInterval;
    this.updatePolling();
  }

  public stopPolling() {
    this.options.pollInterval = 0;
    this.updatePolling();
  }

  private fetch(
    options: WatchQueryOptions<TVariables, TData>,
    newNetworkStatus?: NetworkStatus,
  ): Concast<ApolloQueryResult<TData>> {
    this.queryManager.setObservableQuery(this);
    return this.queryManager.fetchQueryObservable(
      this.queryId,
      options,
      newNetworkStatus,
    );
  }

  // Turns polling on or off based on this.options.pollInterval.
  private updatePolling() {
    // Avoid polling in SSR mode
    if (this.queryManager.ssrMode) {
      return;
    }

    const {
      pollingInfo,
      options: {
        pollInterval,
      },
    } = this;

    if (!pollInterval) {
      if (pollingInfo) {
        clearTimeout(pollingInfo.timeout);
        delete this.pollingInfo;
      }
      return;
    }

    if (pollingInfo &&
        pollingInfo.interval === pollInterval) {
      return;
    }

    invariant(
      pollInterval,
      'Attempted to start a polling query without a polling interval.',
    );

    const info = pollingInfo || (this.pollingInfo = {} as any);
    info.interval = pollInterval;

    const maybeFetch = () => {
      if (this.pollingInfo) {
        if (!isNetworkRequestInFlight(this.queryInfo.networkStatus)) {
          this.reobserve({
            fetchPolicy: "network-only",
          }, NetworkStatus.poll).then(poll, poll);
        } else {
          poll();
        }
      };
    };

    const poll = () => {
      const info = this.pollingInfo;
      if (info) {
        clearTimeout(info.timeout);
        info.timeout = setTimeout(maybeFetch, info.interval);
      }
    };

    poll();
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

  public reobserve(
    newOptions?: Partial<WatchQueryOptions<TVariables, TData>>,
    newNetworkStatus?: NetworkStatus,
  ): Promise<ApolloQueryResult<TData>> {
    this.isTornDown = false;

    const useDisposableConcast =
      // Refetching uses a disposable Concast to allow refetches using different
      // options/variables, without permanently altering the options of the
      // original ObservableQuery.
      newNetworkStatus === NetworkStatus.refetch ||
      // The fetchMore method does not actually call the reobserve method, but,
      // if it did, it would definitely use a disposable Concast.
      newNetworkStatus === NetworkStatus.fetchMore ||
      // Polling uses a disposable Concast so the polling options (which force
      // fetchPolicy to be "network-only") won't override the original options.
      newNetworkStatus === NetworkStatus.poll;

    // Save the old variables, since Object.assign may modify them below.
    const oldVariables = this.options.variables;

    const options = useDisposableConcast
      // Disposable Concast fetches receive a shallow copy of this.options
      // (merged with newOptions), leaving this.options unmodified.
      ? compact(this.options, newOptions)
      : Object.assign(this.options, compact(newOptions));

    if (!useDisposableConcast) {
      // We can skip calling updatePolling if we're not changing this.options.
      this.updatePolling();

      // Reset options.fetchPolicy to its original value when variables change,
      // unless a new fetchPolicy was provided by newOptions.
      if (
        newOptions &&
        newOptions.variables &&
        !newOptions.fetchPolicy &&
        !equal(newOptions.variables, oldVariables)
      ) {
        options.fetchPolicy = this.initialFetchPolicy;
        if (newNetworkStatus === void 0) {
          newNetworkStatus = NetworkStatus.setVariables;
        }
      }
    }

    const concast = this.fetch(options, newNetworkStatus);

    if (!useDisposableConcast) {
      // We use the {add,remove}Observer methods directly to avoid wrapping
      // observer with an unnecessary SubscriptionObserver object, in part so
      // that we can remove it here without triggering any unsubscriptions,
      // because we just want to ignore the old observable, not prematurely shut
      // it down, since other consumers may be awaiting this.concast.promise.
      if (this.concast) {
        this.concast.removeObserver(this.observer, true);
      }

      this.concast = concast;
    }

    concast.addObserver(this.observer);

    return concast.promise;
  }

  // Pass the current result to this.observer.next without applying any
  // fetch policies.
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
        ...this.lastResult,
        error,
        errors: error.graphQLErrors,
        networkStatus: NetworkStatus.error,
        loading: false,
      } as ApolloQueryResult<TData>);

      iterateObserversSafely(this.observers, 'error', this.lastError = error);
    },
  };

  public hasObservers() {
    return this.observers.size > 0;
  }

  private tearDownQuery() {
    if (this.isTornDown) return;
    if (this.concast) {
      this.concast.removeObserver(this.observer);
      delete this.concast;
    }

    this.stopPolling();
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

// Adopt options.nextFetchPolicy (if defined) as a replacement for
// options.fetchPolicy. Since this method also removes options.nextFetchPolicy
// from options, the adoption tends to be idempotent, unless nextFetchPolicy
// is a function that keeps setting options.nextFetchPolicy (uncommon).
export function applyNextFetchPolicy<TData, TVars>(
  options: Pick<
    WatchQueryOptions<TVars, TData>,
    | "fetchPolicy"
    | "nextFetchPolicy"
  >,
) {
  const {
    fetchPolicy = "cache-first",
    nextFetchPolicy,
  } = options;

  if (nextFetchPolicy) {
    // When someone chooses "cache-and-network" or "network-only" as their
    // initial FetchPolicy, they often do not want future cache updates to
    // trigger unconditional network requests, which is what repeatedly
    // applying the "cache-and-network" or "network-only" policies would seem
    // to imply. Instead, when the cache reports an update after the initial
    // network request, it may be desirable for subsequent network requests to
    // be triggered only if the cache result is incomplete. To that end, the
    // options.nextFetchPolicy option provides an easy way to update
    // options.fetchPolicy after the intial network request, without having to
    // call observableQuery.setOptions.
    options.fetchPolicy = typeof nextFetchPolicy === "function"
      ? nextFetchPolicy.call(options, fetchPolicy)
      : nextFetchPolicy;
  }
}
