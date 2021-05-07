import { ApolloLink, Operation, GraphQLRequest, NextLink } from '../core';
import { Observable, ObservableSubscription } from '../../utilities';

export type ContextSetter = (
  operation: GraphQLRequest,
  prevContext: any,
) => Promise<any> | any;

export function setContext(setter: ContextSetter): ApolloLink {
  return new ApolloLink((operation: Operation, forward: NextLink) => {
    const { ...request } = operation;

    return new Observable(observer => {
      let handle: ObservableSubscription;
      Promise.resolve(request)
        .then(req => setter(req, operation.getContext()))
        .then(operation.setContext)
        .then(() => {
          handle = forward(operation).subscribe({
            next: observer.next.bind(observer),
            error: observer.error.bind(observer),
            complete: observer.complete.bind(observer),
          });
        })
        .catch(observer.error.bind(observer));

      return () => {
        if (handle) handle.unsubscribe();
      };
    });
  });
}
