import type { DocumentNode } from 'graphql';

import type { MutationHookOptions, MutationTuple } from '../types/types';
import { MutationData } from '../data/MutationData';
import type { OperationVariables } from '../../core/types';
import { getApolloContext } from '../context/ApolloContext';
import { requireReactLazily } from '../react';

export function useMutation<TData = any, TVariables = OperationVariables>(
  mutation: DocumentNode,
  options?: MutationHookOptions<TData, TVariables>
): MutationTuple<TData, TVariables> {
  const { useContext, useState, useRef, useEffect } = requireReactLazily();
  const context = useContext(getApolloContext());
  const [result, setResult] = useState({ called: false, loading: false });
  const updatedOptions = options ? { ...options, mutation } : { mutation };

  const mutationDataRef = useRef<MutationData<TData, TVariables>>();
  function getMutationDataRef() {
    if (!mutationDataRef.current) {
      mutationDataRef.current = new MutationData<TData, TVariables>({
        options: updatedOptions,
        context,
        result,
        setResult
      });
    }
    return mutationDataRef.current;
  }

  const mutationData = getMutationDataRef();
  mutationData.setOptions(updatedOptions);
  mutationData.context = context;

  useEffect(() => mutationData.afterExecute());

  return mutationData.execute(result);
}
