import type { DocumentNode } from 'graphql';

import type { SubscriptionHookOptions } from '../types/types';
import { SubscriptionData } from '../data/SubscriptionData';
import type { OperationVariables } from '../../core/types';
import { getApolloContext } from '../context/ApolloContext';
import { requireReactLazily } from '../react';

export function useSubscription<TData = any, TVariables = OperationVariables>(
  subscription: DocumentNode,
  options?: SubscriptionHookOptions<TData, TVariables>
) {
  const React = requireReactLazily();
  const { useContext, useState, useRef, useEffect } = React;
  const context = useContext(getApolloContext());
  const updatedOptions = options
    ? { ...options, subscription }
    : { subscription };
  const [result, setResult] = useState({
    loading: !updatedOptions.skip,
    error: undefined,
    data: undefined
  });

  const subscriptionDataRef = useRef<SubscriptionData<TData, TVariables>>();
  function getSubscriptionDataRef() {
    if (!subscriptionDataRef.current) {
      subscriptionDataRef.current = new SubscriptionData<TData, TVariables>({
        options: updatedOptions,
        context,
        setResult
      });
    }
    return subscriptionDataRef.current;
  }

  const subscriptionData = getSubscriptionDataRef();
  subscriptionData.setOptions(updatedOptions, true);
  subscriptionData.context = context;

  useEffect(() => subscriptionData.afterExecute());
  useEffect(() => subscriptionData.cleanup.bind(subscriptionData), []);

  return subscriptionData.execute(result);
}
