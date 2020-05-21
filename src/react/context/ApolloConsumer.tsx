import { invariant } from 'ts-invariant';

import type { ApolloClient } from '../../ApolloClient';
import { getApolloContext } from './ApolloContext';
import { requireReactLazily } from '../react';

export interface ApolloConsumerProps {
  children: (client: ApolloClient<object>) => React.ReactChild | null;
}

export const ApolloConsumer: React.FC<ApolloConsumerProps> = props => {
  const React = requireReactLazily();
  const ApolloContext = getApolloContext();
  return (
    <ApolloContext.Consumer>
      {(context: any) => {
        invariant(
          context && context.client,
          'Could not find "client" in the context of ApolloConsumer. ' +
            'Wrap the root component in an <ApolloProvider>.'
        );
        return props.children(context.client);
      }}
    </ApolloContext.Consumer>
  );
};
