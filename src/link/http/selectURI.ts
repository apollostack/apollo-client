import type { Operation } from '../core/types';

export const selectURI = (
  operation: Operation,
  fallbackURI?: string | ((operation: Operation) => string),
) => {
  const context = operation.getContext();
  const contextURI = context.uri;

  if (contextURI) {
    return contextURI;
  } else if (typeof fallbackURI === 'function') {
    return fallbackURI(operation);
  } else {
    return (fallbackURI as string) || '/graphql';
  }
};
