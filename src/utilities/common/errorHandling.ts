import type { ExecutionResult } from 'graphql';

export function tryFunctionOrLogError(f: Function) {
  try {
    return f();
  } catch (e) {
    if (console.error) {
      console.error(e);
    }
  }
}

export function graphQLResultHasError(result: ExecutionResult): boolean {
  return (result.errors && result.errors.length > 0) || false;
}
