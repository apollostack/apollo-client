import { Operation, FetchResult, NextLink } from '../core';
import { Observable } from '../../utilities';

export type BatchHandler = (
  operations: Operation[],
  forward?: (NextLink | undefined)[],
) => Observable<FetchResult[]> | null;

export interface BatchableRequest {
  operation: Operation;
  forward?: NextLink;

  // promise is created when the query fetch request is
  // added to the queue and is resolved once the result is back
  // from the server.
  observable?: Observable<FetchResult>;
  next?: Array<(result: FetchResult) => void>;
  error?: Array<(error: Error) => void>;
  complete?: Array<() => void>;
}

// QueryBatcher doesn't fire requests immediately. Requests that were enqueued within
// a certain amount of time (configurable through `batchInterval`) will be batched together
// into one query.
export class OperationBatcher {
  // Queue on which the QueryBatcher will operate on a per-tick basis.
  // Public only for testing
  public queuedRequests: Map<string, BatchableRequest[]>;

  private scheduledBatchTimer: ReturnType<typeof setTimeout>;
  private batchDebounce?: boolean;
  private batchInterval?: number;
  private batchMax: number;

  //This function is called to the queries in the queue to the server.
  private batchHandler: BatchHandler;
  private batchKey: (operation: Operation) => string;

  constructor({
    batchDebounce,
    batchInterval,
    batchMax,
    batchHandler,
    batchKey,
  }: {
    batchDebounce?: boolean;
    batchInterval?: number;
    batchMax?: number;
    batchHandler: BatchHandler;
    batchKey?: (operation: Operation) => string;
  }) {
    this.queuedRequests = new Map();
    this.batchDebounce = batchDebounce;
    this.batchInterval = batchInterval;
    this.batchMax = batchMax || 0;
    this.batchHandler = batchHandler;
    this.batchKey = batchKey || (() => '');
  }

  public enqueueRequest(request: BatchableRequest): Observable<FetchResult> {
    const requestCopy = {
      ...request,
    };
    let queued = false;

    const key = this.batchKey(request.operation);

    if (!requestCopy.observable) {
      requestCopy.observable = new Observable<FetchResult>(observer => {
        if (!this.queuedRequests.has(key)) {
          this.queuedRequests.set(key, []);
        }

        if (!queued) {
          this.queuedRequests.get(key)!.push(requestCopy);
          queued = true;
        }

        //called for each subscriber, so need to save all listeners(next, error, complete)
        requestCopy.next = requestCopy.next || [];
        if (observer.next) requestCopy.next.push(observer.next.bind(observer));

        requestCopy.error = requestCopy.error || [];
        if (observer.error)
          requestCopy.error.push(observer.error.bind(observer));

        requestCopy.complete = requestCopy.complete || [];
        if (observer.complete)
          requestCopy.complete.push(observer.complete.bind(observer));

        // The first enqueued request triggers the queue consumption after `batchInterval` milliseconds.
        if (this.queuedRequests.get(key)!.length === 1) {
          this.scheduleQueueConsumption(key);
        } else if (this.batchDebounce) {
          clearTimeout(this.scheduledBatchTimer);
          this.scheduleQueueConsumption(key);
        }

        // When amount of requests reaches `batchMax`, trigger the queue consumption without waiting on the `batchInterval`.
        if (this.queuedRequests.get(key)!.length === this.batchMax) {
          this.consumeQueue(key);
        }
      });
    }

    return requestCopy.observable;
  }

  // Consumes the queue.
  // Returns a list of promises (one for each query).
  public consumeQueue(
    key?: string,
  ): (Observable<FetchResult> | undefined)[] | undefined {
    const requestKey = key || '';
    const queuedRequests = this.queuedRequests.get(requestKey);

    if (!queuedRequests) {
      return;
    }

    this.queuedRequests.delete(requestKey);

    const requests: Operation[] = queuedRequests.map(
      queuedRequest => queuedRequest.operation,
    );

    const forwards: (NextLink | undefined)[] = queuedRequests.map(
      queuedRequest => queuedRequest.forward,
    );

    const observables: (Observable<FetchResult> | undefined)[] = [];
    const nexts: any[] = [];
    const errors: any[] = [];
    const completes: any[] = [];
    queuedRequests.forEach((batchableRequest, index) => {
      observables.push(batchableRequest.observable);
      nexts.push(batchableRequest.next);
      errors.push(batchableRequest.error);
      completes.push(batchableRequest.complete);
    });

    const batchedObservable =
      this.batchHandler(requests, forwards) || Observable.of();

    const onError = (error: any) => {
      //each callback list in batch
      errors.forEach(rejecters => {
        if (rejecters) {
          //each subscriber to request
          rejecters.forEach((e: any) => e(error));
        }
      });
    };

    batchedObservable.subscribe({
      next: results => {
        if (!Array.isArray(results)) {
          results = [results];
        }

        if (nexts.length !== results.length) {
          const error = new Error(
            `server returned results with length ${
              results.length
            }, expected length of ${nexts.length}`,
          );
          (error as any).result = results;

          return onError(error);
        }

        results.forEach((result, index) => {
          if (nexts[index]) {
            nexts[index].forEach((next: any) => next(result));
          }
        });
      },
      error: onError,
      complete: () => {
        completes.forEach(complete => {
          if (complete) {
            //each subscriber to request
            complete.forEach((c: any) => c());
          }
        });
      },
    });

    return observables;
  }

  private scheduleQueueConsumption(key?: string): void {
    const requestKey = key || '';
    this.scheduledBatchTimer = (setTimeout(() => {
      if (
        this.queuedRequests.get(requestKey) &&
        this.queuedRequests.get(requestKey)!.length
      ) {
        this.consumeQueue(requestKey);
      }
    }, this.batchInterval));
  }
}
