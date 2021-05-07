import { ApolloLink, Operation, FetchResult, NextLink } from '../core';
import { Observable, Observer, ObservableSubscription } from '../../utilities';
import {
  DelayFunction,
  DelayFunctionOptions,
  buildDelayFunction,
} from './delayFunction';
import {
  RetryFunction,
  RetryFunctionOptions,
  buildRetryFunction,
} from './retryFunction';

export namespace RetryLink {
  export interface Options {
    /**
     * Configuration for the delay strategy to use, or a custom delay strategy.
     */
    delay?: DelayFunctionOptions | DelayFunction;

    /**
     * Configuration for the retry strategy to use, or a custom retry strategy.
     */
    attempts?: RetryFunctionOptions | RetryFunction;
  }
}

/**
 * Tracking and management of operations that may be (or currently are) retried.
 */
class RetryableOperation<TValue = any> {
  private retryCount: number = 0;
  private values: any[] = [];
  private error: any;
  private complete = false;
  private canceled = false;
  private observers: (Observer<TValue> | null)[] = [];
  private currentSubscription: ObservableSubscription | null = null;
  private timerId: number | undefined;

  constructor(
    private operation: Operation,
    private nextLink: NextLink,
    private delayFor: DelayFunction,
    private retryIf: RetryFunction,
  ) {}

  /**
   * Register a new observer for this operation.
   *
   * If the operation has previously emitted other events, they will be
   * immediately triggered for the observer.
   */
  public subscribe(observer: Observer<TValue>) {
    if (this.canceled) {
      throw new Error(
        `Subscribing to a retryable link that was canceled is not supported`,
      );
    }
    this.observers.push(observer);

    // If we've already begun, catch this observer up.
    for (const value of this.values) {
      observer.next!(value);
    }

    if (this.complete) {
      observer.complete!();
    } else if (this.error) {
      observer.error!(this.error);
    }
  }

  /**
   * Remove a previously registered observer from this operation.
   *
   * If no observers remain, the operation will stop retrying, and unsubscribe
   * from its downstream link.
   */
  public unsubscribe(observer: Observer<TValue>) {
    const index = this.observers.indexOf(observer);
    if (index < 0) {
      throw new Error(
        `RetryLink BUG! Attempting to unsubscribe unknown observer!`,
      );
    }
    // Note that we are careful not to change the order of length of the array,
    // as we are often mid-iteration when calling this method.
    this.observers[index] = null;

    // If this is the last observer, we're done.
    if (this.observers.every(o => o === null)) {
      this.cancel();
    }
  }

  /**
   * Start the initial request.
   */
  public start() {
    if (this.currentSubscription) return; // Already started.

    this.try();
  }

  /**
   * Stop retrying for the operation, and cancel any in-progress requests.
   */
  public cancel() {
    if (this.currentSubscription) {
      this.currentSubscription.unsubscribe();
    }
    clearTimeout(this.timerId);
    this.timerId = undefined;
    this.currentSubscription = null;
    this.canceled = true;
  }

  private try() {
    this.currentSubscription = this.nextLink(this.operation).subscribe({
      next: this.onNext,
      error: this.onError,
      complete: this.onComplete,
    });
  }

  private onNext = (value: any) => {
    this.values.push(value);
    for (const observer of this.observers) {
      if (!observer) continue;
      observer.next!(value);
    }
  };

  private onComplete = () => {
    this.complete = true;
    for (const observer of this.observers) {
      if (!observer) continue;
      observer.complete!();
    }
  };

  private onError = async (error: any) => {
    this.retryCount += 1;

    // Should we retry?
    const shouldRetry = await this.retryIf(
      this.retryCount,
      this.operation,
      error,
    );
    if (shouldRetry) {
      this.scheduleRetry(this.delayFor(this.retryCount, this.operation, error));
      return;
    }

    this.error = error;
    for (const observer of this.observers) {
      if (!observer) continue;
      observer.error!(error);
    }
  };

  private scheduleRetry(delay: number) {
    if (this.timerId) {
      throw new Error(`RetryLink BUG! Encountered overlapping retries`);
    }

    this.timerId = (setTimeout(() => {
      this.timerId = undefined;
      this.try();
    }, delay) as any) as number;
  }
}

export class RetryLink extends ApolloLink {
  private delayFor: DelayFunction;
  private retryIf: RetryFunction;

  constructor(options?: RetryLink.Options) {
    super();
    const { attempts, delay } = options || ({} as RetryLink.Options);
    this.delayFor =
      typeof delay === 'function' ? delay : buildDelayFunction(delay);
    this.retryIf =
      typeof attempts === 'function' ? attempts : buildRetryFunction(attempts);
  }

  public request(
    operation: Operation,
    nextLink: NextLink,
  ): Observable<FetchResult> {
    const retryable = new RetryableOperation(
      operation,
      nextLink,
      this.delayFor,
      this.retryIf,
    );
    retryable.start();

    return new Observable(observer => {
      retryable.subscribe(observer);
      return () => {
        retryable.unsubscribe(observer);
      };
    });
  }
}
