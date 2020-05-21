import type { DocumentNode, GraphQLError } from 'graphql';

import type { FetchResult } from '../link/core/types';
import type { QueryInfo } from './QueryInfo';
import type { NetworkStatus } from './networkStatus';
import type { Resolver } from './LocalState';

export type QueryListener = (queryInfo: QueryInfo) => void;

export type OperationVariables = Record<string, any>;

export type PureQueryOptions = {
  query: DocumentNode;
  variables?: { [key: string]: any };
  context?: any;
};

export type ApolloQueryResult<T> = {
  data?: T;
  errors?: ReadonlyArray<GraphQLError>;
  loading: boolean;
  networkStatus: NetworkStatus;
};

// This is part of the public API, people write these functions in `updateQueries`.
export type MutationQueryReducer<T> = (
  previousResult: Record<string, any>,
  options: {
    mutationResult: FetchResult<T>;
    queryName: string | undefined;
    queryVariables: Record<string, any>;
  },
) => Record<string, any>;

export type MutationQueryReducersMap<T = { [key: string]: any }> = {
  [queryName: string]: MutationQueryReducer<T>;
};

export interface Resolvers {
  [key: string]: {
    [ field: string ]: Resolver;
  };
}
