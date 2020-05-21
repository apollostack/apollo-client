import type { ObservableQuery } from '../../core/ObservableQuery';
import type { ApolloQueryResult } from '../../core/types';
import type { ObservableSubscription } from '../../utilities/observables/Observable';
import { asyncMap } from '../../utilities/observables/asyncMap';

export default function subscribeAndCount(
  reject: (reason: any) => any,
  observable: ObservableQuery<any>,
  cb: (handleCount: number, result: ApolloQueryResult<any>) => any,
): ObservableSubscription {
  // Use a Promise queue to prevent callbacks from being run out of order.
  let queue = Promise.resolve();
  let handleCount = 0;

  const subscription = asyncMap(
    observable,
    (result: ApolloQueryResult<any>) => {
      // All previous asynchronous callbacks must complete before cb can
      // be invoked with this result.
      return queue = queue.then(() => {
        return cb(++handleCount, result);
      }).catch(error);
    },
  ).subscribe({ error });

  function error(e: any) {
    subscription.unsubscribe();
    reject(e);
  }

  return subscription;
}
