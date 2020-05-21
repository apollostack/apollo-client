import type { WatchQueryOptions } from './watchQueryOptions';
import { NetworkStatus } from './networkStatus';
import type { ApolloQueryResult } from './types';
import type { Observer } from '../utilities/observables/Observable';
import type { Concast } from '../utilities/observables/Concast';
import { invariant } from 'ts-invariant';

// Given that QueryManager#fetchQueryObservable returns only a single
// query's worth of results, other code must be responsible for repeatedly
// calling fetchQueryObservable, while ensuring that the ObservableQuery
// consuming those results remains subscribed to the concatenation of all
// the observables returned by fetchQueryObservable. That responsibility
// falls to this Reobserver class. As a bonus, the Reobserver class is
// perfectly poised to handle polling logic, since polling is essentially
// repeated reobservation. In principle, this code could have remained in
// the ObservableQuery class, but I felt it would be easier to explain and
// understand reobservation if it was confined to a separate class.
export class Reobserver<TData, TVars> {
  constructor(
    private observer: Observer<ApolloQueryResult<TData>>,
    private options: WatchQueryOptions<TVars>,
    // Almost certainly just a wrapper function around
    // QueryManager#fetchQueryObservable, but this small dose of
    // indirection means the Reobserver doesn't have to know/assume
    // anything about the QueryManager class.
    private fetch: (
      options: WatchQueryOptions<TVars>,
      newNetworkStatus?: NetworkStatus,
    ) => Concast<ApolloQueryResult<TData>>,
    // If we're polling, there may be times when we should avoid fetching,
    // such as when the query is already in flight, or polling has been
    // completely disabled for server-side rendering. Passing false for
    // this parameter disables polling completely, and passing a boolean
    // function allows determining fetch safety dynamically.
    private shouldFetch: false | (() => boolean),
  ) {}

  private concast?: Concast<ApolloQueryResult<TData>>;

  public reobserve(
    newOptions?: Partial<WatchQueryOptions<TVars>>,
    newNetworkStatus?: NetworkStatus,
  ): Promise<ApolloQueryResult<TData>> {
    if (newOptions) {
      this.updateOptions(newOptions);
    } else {
      // When we call this.updateOptions(newOptions) in the branch above,
      // it takes care of calling this.updatePolling(). In this branch, we
      // still need to update polling, even if there were no newOptions.
      this.updatePolling();
    }

    const concast = this.fetch(this.options, newNetworkStatus);

    if (this.concast) {
      // We use the {add,remove}Observer methods directly to avoid
      // wrapping observer with an unnecessary SubscriptionObserver
      // object, in part so that we can remove it here without triggering
      // any unsubscriptions, because we just want to ignore the old
      // observable, not prematurely shut it down, since other consumers
      // may be awaiting this.concast.promise.
      this.concast.removeObserver(this.observer, true);
    }

    concast.addObserver(this.observer);

    return (this.concast = concast).promise;
  }

  public updateOptions(newOptions: Partial<WatchQueryOptions<TVars>>) {
    Object.keys(newOptions).forEach(key => {
      const value = (newOptions as any)[key];
      if (value !== void 0) {
        (this.options as any)[key] = value;
      }
    });

    this.updatePolling();

    return this;
  }

  public stop() {
    if (this.concast) {
      this.concast.removeObserver(this.observer);
      delete this.concast;
    }

    if (this.pollingInfo) {
      clearTimeout(this.pollingInfo.timeout);
      this.options.pollInterval = 0;
      this.updatePolling();
    }
  }

  private pollingInfo?: {
    interval: number;
    timeout: ReturnType<typeof setTimeout>;
  };

  // Turns polling on or off based on this.options.pollInterval.
  private updatePolling() {
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

    // Go no further if polling is disabled.
    if (this.shouldFetch === false) {
      return;
    }

    const info = pollingInfo || (
      this.pollingInfo = {} as Reobserver<TData, TVars>["pollingInfo"]
    )!;

    info.interval = pollInterval;

    const maybeFetch = () => {
      if (this.pollingInfo) {
        if (this.shouldFetch && this.shouldFetch()) {
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
}
