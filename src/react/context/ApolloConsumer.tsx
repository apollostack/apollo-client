import * as React from 'react';
import { invariant } from 'ts-invariant';

import { ApolloClient } from '../../core';
import { getApolloContext } from './ApolloContext';

export interface ApolloConsumerProps {
  children: (client: ApolloClient<object>) => React.ReactChild | null;
}

export const ApolloConsumer: React.FC<ApolloConsumerProps> = props => {
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
