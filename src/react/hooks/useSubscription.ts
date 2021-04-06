import { useContext, useState, useRef, useEffect } from 'react';
import { DocumentNode } from 'graphql';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';

import { SubscriptionHookOptions } from '../types/types';
import { SubscriptionData } from '../data';
import { OperationVariables } from '../../core';
import { getApolloContext } from '../context';

export function useSubscription<TData = any, TVariables = OperationVariables>(
  subscription: DocumentNode | TypedDocumentNode<TData, TVariables>,
  options?: SubscriptionHookOptions<TData, TVariables>
) {
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
