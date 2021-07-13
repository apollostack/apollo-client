import * as React from 'react';
import { invariant } from 'ts-invariant';

import { ApolloClient } from '../../core';
import { getApolloContext } from './ApolloContext';

export interface ApolloProviderProps<TCache> {
  client: ApolloClient<TCache>;
  children: React.ReactNode | React.ReactNode[] | null;
}

export const ApolloProvider: React.FC<ApolloProviderProps<any>> = ({
  client,
  children
}) => {
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
