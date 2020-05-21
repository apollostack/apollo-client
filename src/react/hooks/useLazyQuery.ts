import type { DocumentNode } from 'graphql';

import type { LazyQueryHookOptions, QueryTuple } from '../types/types';
import { useBaseQuery } from './utils/useBaseQuery';
import type { OperationVariables } from '../../core/types';

export function useLazyQuery<TData = any, TVariables = OperationVariables>(
  query: DocumentNode,
  options?: LazyQueryHookOptions<TData, TVariables>
) {
  return useBaseQuery<TData, TVariables>(query, options, true) as QueryTuple<
    TData,
    TVariables
  >;
}
