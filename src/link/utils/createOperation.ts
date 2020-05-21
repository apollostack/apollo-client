import type { GraphQLRequest, Operation } from '../core/types';

export function createOperation(
  starting: any,
  operation: GraphQLRequest,
): Operation {
  let context = { ...starting };
  const setContext = (next: any) => {
    if (typeof next === 'function') {
      context = { ...context, ...next(context) };
    } else {
      context = { ...context, ...next };
    }
  };
  const getContext = () => ({ ...context });

  Object.defineProperty(operation, 'setContext', {
    enumerable: false,
    value: setContext,
  });

  Object.defineProperty(operation, 'getContext', {
    enumerable: false,
    value: getContext,
  });

  return operation as Operation;
}
