import { DocumentNode, ExecutionResult } from 'graphql';
export { DocumentNode };

import { Observable } from '../../utilities';

export interface GraphQLRequest<TVariables = Record<string, any>> {
  query: DocumentNode;
  variables?: TVariables;
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
