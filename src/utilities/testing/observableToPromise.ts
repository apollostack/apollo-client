import type { ObservableQuery } from '../../core/ObservableQuery';
import type { ApolloQueryResult } from '../../core/types';
import type { ObservableSubscription } from '../../utilities/observables/Observable';

/**
 *
 * @param observable the observable query to subscribe to
 * @param shouldResolve should we resolve after seeing all our callbacks [default: true]
 *   (use this if you are racing the promise against another)
 * @param wait how long to wait after seeing desired callbacks before resolving
 *   [default: -1 => don't wait]
 * @param errorCallbacks an expected set of errors
 */
export type Options = {
  observable: ObservableQuery<any>;
  shouldResolve?: boolean;
  wait?: number;
  errorCallbacks?: ((error: Error) => any)[];
};

export type ResultCallback = ((result: ApolloQueryResult<any>) => any);

// Take an observable and N callbacks, and observe the observable,
// ensuring it is called exactly N times, resolving once it has done so.
// Optionally takes a timeout, which it will wait X ms after the Nth callback
// to ensure it is not called again.
export function observableToPromiseAndSubscription(
  { observable, shouldResolve = true, wait = -1, errorCallbacks = [] }: Options,
  ...cbs: ResultCallback[]
): { promise: Promise<any[]>; subscription: ObservableSubscription } {
  let subscription: ObservableSubscription = null as never;
  const promise = new Promise<any[]>((resolve, reject) => {
    let errorIndex = 0;
    let cbIndex = 0;
    const results: any[] = [];

    const tryToResolve = () => {
      if (!shouldResolve) {
        return;
      }

      const done = () => {
        subscription.unsubscribe();
        // XXX: we could pass a few other things out here?
        resolve(results);
      };

      if (cbIndex === cbs.length && errorIndex === errorCallbacks.length) {
        if (wait === -1) {
          done();
        } else {
          setTimeout(done, wait);
        }
      }
    };

    let queue = Promise.resolve();

    subscription = observable.subscribe({
      next(result: ApolloQueryResult<any>) {
        queue = queue.then(() => {
          const cb = cbs[cbIndex++];
          if (cb) return cb(result);
          reject(new Error(`Observable 'next' method called more than ${cbs.length} times`));
        }).then(
          res => {
            results.push(res);
            tryToResolve();
          },
          reject,
        );
      },
      error(error: Error) {
        queue = queue.then(() => {
          const errorCb = errorCallbacks[errorIndex++];
          if (errorCb) return errorCb(error);
          reject(error);
        }).then(
          tryToResolve,
          reject,
        );
      },
    });
  });

  return {
    promise,
    subscription,
  };
}

export default function(
  options: Options,
  ...cbs: ResultCallback[]
): Promise<any[]> {
  return observableToPromiseAndSubscription(options, ...cbs).promise;
}
