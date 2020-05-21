import type { DocumentNode } from 'graphql';

import type { QueryHookOptions, QueryResult } from '../types/types';
import { useBaseQuery } from './utils/useBaseQuery';
import type { OperationVariables } from '../../core/types';

export function useQuery<TData = any, TVariables = OperationVariables>(
  query: DocumentNode,
  options?: QueryHookOptions<TData, TVariables>
) {
  return useBaseQuery<TData, TVariables>(query, options, false) as QueryResult<
    TData,
    TVariables
  >;
}
