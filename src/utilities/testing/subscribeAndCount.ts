import { ObservableQuery } from '../../core/ObservableQuery';
import { ApolloQueryResult, OperationVariables } from '../../core/types';
import { ObservableSubscription } from '../../utilities/observables/Observable';
import { asyncMap } from '../../utilities/observables/asyncMap';

export default function subscribeAndCount<
  TData,
  TVariables = OperationVariables,
>(
  reject: (reason: any) => any,
  observable: ObservableQuery<TData, TVariables>,
  cb: (handleCount: number, result: ApolloQueryResult<TData>) => any,
): ObservableSubscription {
  // Use a Promise queue to prevent callbacks from being run out of order.
  let queue = Promise.resolve();
  let handleCount = 0;

  const subscription = asyncMap(
    observable,
    (result: ApolloQueryResult<TData>) => {
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
