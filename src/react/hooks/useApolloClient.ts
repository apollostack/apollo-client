import { invariant } from 'ts-invariant';

import type { ApolloClient } from '../../ApolloClient';
import { getApolloContext } from '../context/ApolloContext';
import { requireReactLazily } from '../react';

export function useApolloClient(): ApolloClient<object> {
  const React = requireReactLazily();
  const { client } = React.useContext(getApolloContext());
  invariant(
    client,
    'No Apollo Client instance can be found. Please ensure that you ' +
      'have called `ApolloProvider` higher up in your tree.'
  );
  return client!;
}
