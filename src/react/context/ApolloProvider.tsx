import { invariant } from 'ts-invariant';

import type { ApolloClient } from '../../ApolloClient';
import { getApolloContext } from './ApolloContext';
import { requireReactLazily } from '../react';

export interface ApolloProviderProps<TCache> {
  client: ApolloClient<TCache>;
  children: React.ReactNode | React.ReactNode[] | null;
}

export const ApolloProvider: React.FC<ApolloProviderProps<any>> = ({
  client,
  children
}) => {
  const React = requireReactLazily();
  const ApolloContext = getApolloContext();
  return (
    <ApolloContext.Consumer>
      {(context: any = {}) => {
        if (client && context.client !== client) {
          context = Object.assign({}, context, { client });
        }

        invariant(
          context.client,
          'ApolloProvider was not passed a client instance. Make ' +
            'sure you pass in your client via the "client" prop.'
        );

        return (
          <ApolloContext.Provider value={context}>
            {children}
          </ApolloContext.Provider>
        );
      }}
    </ApolloContext.Consumer>
  );
};
