import { NormalizedCacheObject } from './../../cache/inmemory/types';
import React from 'react';
import { invariant } from 'ts-invariant';

import { ApolloClient } from '../../core';
import { getApolloContext } from '../context';

export function useApolloClient(): ApolloClient<NormalizedCacheObject> {
  const { client } = React.useContext(getApolloContext());
  invariant(
    client,
    'No Apollo Client instance can be found. Please ensure that you ' +
      'have called `ApolloProvider` higher up in your tree.'
  );
  return client!;
}
