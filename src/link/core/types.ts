import type { DocumentNode } from 'graphql/language/ast';
import type { ExecutionResult } from 'graphql/execution/execute';
export { DocumentNode };

import type { Observable } from '../../utilities/observables/Observable';

export interface GraphQLRequest {
  query: DocumentNode;
  variables?: Record<string, any>;
  operationName?: string;
  context?: Record<string, any>;
  extensions?: Record<string, any>;
}

export interface Operation {
  query: DocumentNode;
  variables: Record<string, any>;
  operationName: string;
  extensions: Record<string, any>;
  setContext: (context: Record<string, any>) => Record<string, any>;
  getContext: () => Record<string, any>;
}

export interface FetchResult<
  TData = { [key: string]: any },
  C = Record<string, any>,
  E = Record<string, any>
> extends ExecutionResult {
  data?: TData | null;
  extensions?: E;
  context?: C;
};

export type NextLink = (operation: Operation) => Observable<FetchResult>;

export type RequestHandler = (
  operation: Operation,
  forward: NextLink,
) => Observable<FetchResult> | null;
