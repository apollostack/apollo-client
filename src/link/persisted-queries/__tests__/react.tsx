import * as React from 'react';
import * as ReactDOM from 'react-dom/server';
import gql from 'graphql-tag';
import { print } from 'graphql';
import { sha256 } from 'crypto-hash';
import fetch from 'jest-fetch-mock';

import { ApolloProvider } from '../../../react/context';
import { InMemoryCache as Cache } from '../../../cache/inmemory/inMemoryCache';
import { ApolloClient } from '../../../core/ApolloClient';
import { createHttpLink } from '../../http/createHttpLink';
import { graphql } from '../../../react/hoc/graphql';
import { getDataFromTree } from '../../../react/ssr/getDataFromTree';
import { createPersistedQueryLink as createPersistedQuery, VERSION } from '../';

global.fetch = fetch;

const query = gql`
  query Test($filter: FilterObject) {
    foo(filter: $filter) {
      bar
    }
  }
`;

const variables = {
  filter: {
    $filter: 'smash',
  },
};
const variables2 = {
  filter: null,
};
const data = {
  foo: { bar: true },
};
const data2 = {
  foo: { bar: false },
};
const response = JSON.stringify({ data });
const response2 = JSON.stringify({ data: data2 });
const queryString = print(query);

let hash: string;
(async () => {
  hash = await sha256(queryString);
})();

describe('react application', () => {
  beforeEach(fetch.mockReset);
  it('works on a simple tree', async () => {
    fetch.mockResponseOnce(response);
    fetch.mockResponseOnce(response2);

    const link = createPersistedQuery({ sha256 }).concat(createHttpLink());

    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false }),
      ssrMode: true,
    });

    const Query = graphql(query)(({ data, children }) => {
      if (data!.loading) return null;

      return (
        <div>
          {(data as any).foo.bar && 'data was returned!'}
          {children}
        </div>
      );
    });
    const app = (
      <ApolloProvider client={client}>
        <Query {...variables}>
          <h1>Hello!</h1>
        </Query>
      </ApolloProvider>
    );

    // preload all the data for client side request (with filter)
    const result = await getDataFromTree(app);
    expect(result).toContain('data was returned');
    let [, request] = fetch.mock.calls[0];
    expect(request!.body).toBe(
      JSON.stringify({
        operationName: 'Test',
        variables,
        extensions: {
          persistedQuery: {
            version: VERSION,
            sha256Hash: hash,
          },
        },
      }),
    );

    // reset client and try with different input object
    const client2 = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false }),
      ssrMode: true,
    });

    const app2 = (
      <ApolloProvider client={client2}>
        <Query {...variables2}>
          <h1>Hello!</h1>
        </Query>
      </ApolloProvider>
    );

    // change filter object to different variables and SSR
    await getDataFromTree(app2);
    const markup2 = ReactDOM.renderToString(app2);

    let [, request2] = fetch.mock.calls[1];

    expect(markup2).not.toContain('data was returned');
    expect(request2!.body).toBe(
      JSON.stringify({
        operationName: 'Test',
        variables: variables2,
        extensions: {
          persistedQuery: {
            version: VERSION,
            sha256Hash: hash,
          },
        },
      }),
    );
  });
});
