import { Observable } from '../../../utilities/observables/Observable';
import { ApolloLink } from '../../../link/core/ApolloLink';
import type { FetchResult, Operation } from '../../../link/core/types';

export interface MockedSubscription {
  request: Operation;
}

export interface MockedSubscriptionResult {
  result?: FetchResult;
  error?: Error;
  delay?: number;
}

export class MockSubscriptionLink extends ApolloLink {
  public unsubscribers: any[] = [];
  public setups: any[] = [];

  private observer: any;

  constructor() {
    super();
  }

  public request(_req: any) {
    return new Observable<FetchResult>(observer => {
      this.setups.forEach(x => x());
      this.observer = observer;
      return () => {
        this.unsubscribers.forEach(x => x());
      };
    });
  }

  public simulateResult(result: MockedSubscriptionResult, complete = false) {
    setTimeout(() => {
      const { observer } = this;
      if (!observer) throw new Error('subscription torn down');
      if (complete && observer.complete) observer.complete();
      if (result.result && observer.next) observer.next(result.result);
      if (result.error && observer.error) observer.error(result.error);
    }, result.delay || 0);
  }

  public simulateComplete() {
    const { observer } = this;
    if (!observer) throw new Error('subscription torn down');
    if (observer.complete) observer.complete();
  }

  public onSetup(listener: any): void {
    this.setups = this.setups.concat([listener]);
  }

  public onUnsubscribe(listener: any): void {
    this.unsubscribers = this.unsubscribers.concat([listener]);
  }
}

export function mockObservableLink(): MockSubscriptionLink {
  return new MockSubscriptionLink();
}
