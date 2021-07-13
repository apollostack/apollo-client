import React from 'react';
import { render, wait } from '@testing-library/react';
import gql from 'graphql-tag';

import { itAsync } from '../../itAsync';
import { MockedProvider } from '../MockedProvider';
import { MockedResponse, MockLink } from '../mockLink';
import { DocumentNode } from 'graphql';
import { useQuery } from '../../../../react/hooks/useQuery';
import { InMemoryCache } from '../../../../cache/inmemory/inMemoryCache';
import { ApolloLink } from '../../../../link/core';

const variables = {
  username: 'mock_username'
};

const userWithoutTypeName = {
  id: 'user_id'
};

const user = {
  __typename: 'User',
  ...userWithoutTypeName
};

const query: DocumentNode = gql`
  query GetUser($username: String!) {
    user(username: $username) {
      id
    }
  }
`;

const queryWithTypename: DocumentNode = gql`
  query GetUser($username: String!) {
    user(username: $username) {
      id
      __typename
    }
  }
`;

const mocks: ReadonlyArray<MockedResponse> = [
  {
    request: {
      query,
      variables
    },
    result: { data: { user } }
  }
];

interface Data {
  user: {
    id: string;
  };
}

interface Variables {
  username: string;
}

let errorThrown = false;
const errorLink = new ApolloLink((operation, forward) => {
  let observer = null;
  try {
    observer = forward(operation);
  } catch (error) {
    errorThrown = true;
  }
  return observer;
});

describe('General use', () => {
  beforeEach(() => {
    errorThrown = false;
  });

  itAsync('should mock the data', (resolve, reject) => {
    function Component({ username }: Variables) {
      const { loading, data } = useQuery<Data, Variables>(query, { variables });
      if (!loading) {
        expect(data!.user).toMatchSnapshot();
      }
      return null;
    }

    render(
      <MockedProvider mocks={mocks}>
        <Component {...variables} />
      </MockedProvider>
    );

    return wait().then(resolve, reject);
  });

  itAsync('should allow querying with the typename', (resolve, reject) => {
    function Component({ username }: Variables) {
      const { loading, data } = useQuery<Data, Variables>(query, { variables });
      if (!loading) {
        expect(data!.user).toMatchSnapshot();
      }
      return null;
    }

    const mocksWithTypename = [
      {
        request: {
          query: queryWithTypename,
          variables
        },
        result: { data: { user } }
      }
    ];

    render(
      <MockedProvider mocks={mocksWithTypename}>
        <Component {...variables} />
      </MockedProvider>
    );

    return wait().then(resolve, reject);
  });

  itAsync('should allow using a custom cache', (resolve, reject) => {
    const cache = new InMemoryCache();
    cache.writeQuery({
      query,
      variables,
      data: { user }
    });

    function Component({ username }: Variables) {
      const { loading, data } = useQuery<Data, Variables>(query, { variables });
      if (!loading) {
        expect(data).toMatchObject({ user });
      }
      return null;
    }

    render(
      <MockedProvider mocks={[]} cache={cache}>
        <Component {...variables} />
      </MockedProvider>
    );

    return wait().then(resolve, reject);
  });

  itAsync('should error if the variables in the mock and component do not match', (resolve, reject) => {
    function Component({ ...variables }: Variables) {
      const { loading, error } = useQuery<Data, Variables>(query, { variables });
      if (!loading) {
        expect(error).toMatchSnapshot();
      }
      return null;
    }

    const variables2 = {
      username: 'other_user',
      age: undefined
    };

    render(
      <MockedProvider mocks={mocks}>
        <Component {...variables2} />
      </MockedProvider>
    );

    return wait().then(resolve, reject);
  });

  itAsync('should error if the variables do not deep equal', (resolve, reject) => {
    function Component({ ...variables }: Variables) {
      const { loading, error } = useQuery<Data, Variables>(query, { variables });
      if (!loading) {
        expect(error).toMatchSnapshot();
      }
      return null;
    }

    const mocks2 = [
      {
        request: {
          query,
          variables: {
            age: 13,
            username: 'some_user'
          }
        },
        result: { data: { user } }
      }
    ];

    const variables2 = {
      username: 'some_user',
      age: 42
    };

    render(
      <MockedProvider mocks={mocks2}>
        <Component {...variables2} />
      </MockedProvider>
    );

    return wait().then(resolve, reject);
  });

  itAsync('should not error if the variables match but have different order', (resolve, reject) => {
    function Component({ ...variables }: Variables) {
      const { loading, data } = useQuery<Data, Variables>(query, { variables });
      if (!loading) {
        expect(data).toMatchSnapshot();
      }
      return null;
    }

    const mocks2 = [
      {
        request: {
          query,
          variables: {
            age: 13,
            username: 'some_user'
          }
        },
        result: { data: { user } }
      }
    ];

    const variables2 = {
      username: 'some_user',
      age: 13
    };

    render(
      <MockedProvider mocks={mocks2}>
        <Component {...variables2} />
      </MockedProvider>
    );

    return wait().then(resolve, reject);
  });

  itAsync('should support mocking a network error', (resolve, reject) => {
    function Component({ ...variables }: Variables) {
      const { loading, error } = useQuery<Data, Variables>(query, { variables });
      if (!loading) {
        expect(error).toEqual(new Error('something went wrong'));
      }
      return null;
    }

    const mocksError = [
      {
        request: {
          query,
          variables
        },
        error: new Error('something went wrong')
      }
    ];

    render(
      <MockedProvider mocks={mocksError}>
        <Component {...variables} />
      </MockedProvider>
    );

    return wait().then(resolve, reject);
  });

  itAsync('should error if the query in the mock and component do not match', (resolve, reject) => {
    function Component({ ...variables }: Variables) {
      const { loading, error } = useQuery<Data, Variables>(query, { variables });
      if (!loading) {
        expect(error).toMatchSnapshot();
      }
      return null;
    }

    const mocksDifferentQuery = [
      {
        request: {
          query: gql`
            query OtherQuery {
              otherQuery {
                id
              }
            }
          `,
          variables
        },
        result: { data: { user } }
      }
    ];

    render(
      <MockedProvider mocks={mocksDifferentQuery}>
        <Component {...variables} />
      </MockedProvider>
    );

    return wait().then(resolve, reject);
  });

  it('should pass down props prop in mock as props for the component', () => {
    function Component({ ...variables }) {
      expect(variables.foo).toBe('bar');
      expect(variables.baz).toBe('qux');
      return null;
    }

    render(
      <MockedProvider mocks={mocks} childProps={{ foo: 'bar', baz: 'qux' }}>
        <Component {...variables} />
      </MockedProvider>
    );
  });

  it('should not crash on unmount if there is no query manager', () => {
    function Component() {
      return null;
    }

    const { unmount } = render(
      <MockedProvider>
        <Component />
      </MockedProvider>
    );

    unmount();
  });

  itAsync('should support returning mocked results from a function', (resolve, reject) => {
    let resultReturned = false;

    const testUser = {
      __typename: 'User',
      id: 12345
    };

    function Component({ ...variables }: Variables) {
      const { loading, data } = useQuery<Data, Variables>(query, { variables });
      if (!loading) {
        expect(data!.user).toEqual(testUser);
        expect(resultReturned).toBe(true);
      }
      return null;
    }

    const testQuery: DocumentNode = gql`
      query GetUser($username: String!) {
        user(username: $username) {
          id
        }
      }
    `;

    const testVariables = {
      username: 'jsmith'
    };
    const testMocks = [
      {
        request: {
          query: testQuery,
          variables: testVariables
        },
        result() {
          resultReturned = true;
          return {
            data: {
              user: {
                __typename: 'User',
                id: 12345
              }
            }
          };
        }
      }
    ];

    render(
      <MockedProvider mocks={testMocks}>
        <Component {...testVariables} />
      </MockedProvider>
    );

    return wait().then(resolve, reject);
  });

  itAsync('should return "No more mocked responses" errors in response', (resolve, reject) => {
    function Component() {
      const { loading, error } = useQuery(query);
      if (!loading) {
        expect(error).toMatchSnapshot();
      }
      return null;
    }

    const link = ApolloLink.from([errorLink, new MockLink([])]);

    render(
      <MockedProvider link={link}>
        <Component />
      </MockedProvider>
    );

    return wait(() => {
      // The "No more mocked responses" error should not be thrown as an
      // uncaught exception.
      expect(errorThrown).toBeFalsy();
    }).then(resolve, reject);
  });

  itAsync('should return "Mocked response should contain" errors in response', (resolve, reject) => {
    function Component({ ...variables }: Variables) {
      const { loading, error } = useQuery<Data, Variables>(query, { variables });
      if (!loading) {
        expect(error).toMatchSnapshot();
      }
      return null;
    }

    const link = ApolloLink.from([errorLink, new MockLink([
      {
        request: {
          query,
          variables
        }
      }
    ])]);

    render(
      <MockedProvider link={link}>
        <Component {...variables} />
      </MockedProvider>
    );

    return wait(() => {
      // The "Mocked response should contain" error should not be thrown as an
      // uncaught exception.
      expect(errorThrown).toBeFalsy();
    }).then(resolve, reject);
  });

  itAsync('should support custom error handling using setOnError', (resolve, reject) => {
    function Component({ ...variables }: Variables) {
      useQuery<Data, Variables>(query, { variables });
      return null;
    }

    const mockLink = new MockLink([]);
    mockLink.setOnError(error => {
      expect(error).toMatchSnapshot();
    });
    const link = ApolloLink.from([errorLink, mockLink]);

    render(
      <MockedProvider link={link}>
        <Component {...variables} />
      </MockedProvider>
    );

    return wait().then(resolve, reject);
  });

  itAsync('should pipe exceptions thrown in custom onError functions through the link chain', (resolve, reject) => {
    function Component({ ...variables }: Variables) {
      const { loading, error } = useQuery<Data, Variables>(query, { variables });
      if (!loading) {
        expect(error).toMatchSnapshot();
      }
      return null;
    }

    const mockLink = new MockLink([]);
    mockLink.setOnError(() => {
      throw new Error('oh no!');
    });
    const link = ApolloLink.from([errorLink, mockLink]);

    render(
      <MockedProvider link={link}>
        <Component {...variables} />
      </MockedProvider>
    );

    return wait().then(resolve, reject);
  });
});

describe('@client testing', () => {
  itAsync('should support @client fields with a custom cache', (resolve, reject) => {
    const cache = new InMemoryCache();

    cache.writeQuery({
      query: gql`{
        networkStatus {
          isOnline
        }
      }`,
      data: {
        networkStatus: {
          __typename: 'NetworkStatus',
          isOnline: true
        }
      },
    });

    function Component() {
      const { loading, data } = useQuery(gql`{
        networkStatus @client {
          isOnline
        }
      }`);
      if (!loading) {
        expect(data!.networkStatus.__typename).toEqual('NetworkStatus');
        expect(data!.networkStatus.isOnline).toEqual(true);
      }
      return null;
    }

    render(
      <MockedProvider cache={cache}>
        <Component />
      </MockedProvider>
    );

    return wait().then(resolve, reject);
  });

  itAsync('should support @client fields with field policies', (resolve, reject) => {
    const cache = new InMemoryCache({
      typePolicies: {
        Query: {
          fields: {
            networkStatus() {
              return {
                __typename: 'NetworkStatus',
                isOnline: true
              };
            }
          }
        }
      }
    });

    function Component() {
      const { loading, data } = useQuery(gql`{
        networkStatus @client {
          isOnline
        }
      }`);
      if (!loading) {
        expect(data!.networkStatus.__typename).toEqual('NetworkStatus');
        expect(data!.networkStatus.isOnline).toEqual(true);
      }
      return null;
    }

    render(
      <MockedProvider cache={cache}>
        <Component />
      </MockedProvider>
    );

    return wait().then(resolve, reject);
  });
});
