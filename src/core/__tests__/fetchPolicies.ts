import gql from 'graphql-tag';

import { ApolloClient, NetworkStatus } from '../../core';
import { ApolloLink } from '../../link/core';
import { InMemoryCache } from '../../cache';
import { Observable } from '../../utilities';
import {
  stripSymbols,
  subscribeAndCount,
  itAsync,
  mockSingleLink,
} from '../../testing';

const query = gql`
  query {
    author {
      __typename
      id
      firstName
      lastName
    }
  }
`;

const result = {
  author: {
    __typename: 'Author',
    id: 1,
    firstName: 'John',
    lastName: 'Smith',
  },
};

const mutation = gql`
  mutation updateName($id: ID!, $firstName: String!) {
    updateName(id: $id, firstName: $firstName) {
      __typename
      id
      firstName
    }
  }
`;

const variables = {
  id: 1,
  firstName: 'James',
};

const mutationResult = {
  updateName: {
    id: 1,
    __typename: 'Author',
    firstName: 'James',
  },
};

const merged = { author: { ...result.author, firstName: 'James' } };

const createLink = (reject: (reason: any) => any) =>
  mockSingleLink({
    request: { query },
    result: { data: result },
  }, {
    request: { query },
    result: { data: result },
  }).setOnError(reject);

const createFailureLink = () =>
  mockSingleLink({
    request: { query },
    error: new Error('query failed'),
  }, {
    request: { query },
    result: { data: result },
  });

const createMutationLink = (reject: (reason: any) => any) =>
  // fetch the data
  mockSingleLink({
    request: { query },
    result: { data: result },
  }, // update the data
  {
    request: { query: mutation, variables },
    result: { data: mutationResult },
  }, // get the new results
  {
    request: { query },
    result: { data: merged },
  }).setOnError(reject);

describe('network-only', () => {
  itAsync('requests from the network even if already in cache', (resolve, reject) => {
    let called = 0;
    const inspector = new ApolloLink((operation, forward) => {
      called++;
      return forward(operation).map(result => {
        called++;
        return result;
      });
    });

    const client = new ApolloClient({
      link: inspector.concat(createLink(reject)),
      cache: new InMemoryCache({ addTypename: false }),
    });

    return client.query({ query }).then(
      () => client
        .query({ fetchPolicy: 'network-only', query })
        .then(actualResult => {
          expect(stripSymbols(actualResult.data)).toEqual(result);
          expect(called).toBe(4);
        }),
    ).then(resolve, reject);
  });

  itAsync('saves data to the cache on success', (resolve, reject) => {
    let called = 0;
    const inspector = new ApolloLink((operation, forward) => {
      called++;
      return forward(operation).map(result => {
        called++;
        return result;
      });
    });

    const client = new ApolloClient({
      link: inspector.concat(createLink(reject)),
      cache: new InMemoryCache({ addTypename: false }),
    });

    return client.query({ query, fetchPolicy: 'network-only' }).then(
      () => client.query({ query }).then(actualResult => {
        expect(stripSymbols(actualResult.data)).toEqual(result);
        expect(called).toBe(2);
      }),
    ).then(resolve, reject);
  });

  itAsync('does not save data to the cache on failure', (resolve, reject) => {
    let called = 0;
    const inspector = new ApolloLink((operation, forward) => {
      called++;
      return forward(operation).map(result => {
        called++;
        return result;
      });
    });

    const client = new ApolloClient({
      link: inspector.concat(createFailureLink()),
      cache: new InMemoryCache({ addTypename: false }),
    });

    let didFail = false;
    return client
      .query({ query, fetchPolicy: 'network-only' })
      .catch(e => {
        expect(e.message).toMatch('query failed');
        didFail = true;
      })
      .then(() => client.query({ query }).then(actualResult => {
        expect(stripSymbols(actualResult.data)).toEqual(result);
        // the first error doesn't call .map on the inspector
        expect(called).toBe(3);
        expect(didFail).toBe(true);
      }))
      .then(resolve, reject);
  });

  itAsync('updates the cache on a mutation', (resolve, reject) => {
    const inspector = new ApolloLink((operation, forward) => {
      return forward(operation).map(result => {
        return result;
      });
    });

    const client = new ApolloClient({
      link: inspector.concat(createMutationLink(reject)),
      cache: new InMemoryCache({ addTypename: false }),
    });

    return client
      .query({ query })
      .then(() =>
        // XXX currently only no-cache is supported as a fetchPolicy
        // this mainly serves to ensure the cache is updated correctly
        client.mutate({ mutation, variables }),
      )
      .then(() => {
        return client.query({ query }).then(actualResult => {
          expect(stripSymbols(actualResult.data)).toEqual(merged);
        });
      })
      .then(resolve, reject);
  });
});

describe('no-cache', () => {
  itAsync('requests from the network when not in cache', (resolve, reject) => {
    let called = 0;
    const inspector = new ApolloLink((operation, forward) => {
      called++;
      return forward(operation).map(result => {
        called++;
        return result;
      });
    });

    const client = new ApolloClient({
      link: inspector.concat(createLink(reject)),
      cache: new InMemoryCache({ addTypename: false }),
    });

    return client
      .query({ fetchPolicy: 'no-cache', query })
      .then(actualResult => {
        expect(actualResult.data).toEqual(result);
        expect(called).toBe(2);
      })
      .then(resolve, reject);
  });

  itAsync('requests from the network even if already in cache', (resolve, reject) => {
    let called = 0;
    const inspector = new ApolloLink((operation, forward) => {
      called++;
      return forward(operation).map(result => {
        called++;
        return result;
      });
    });

    const client = new ApolloClient({
      link: inspector.concat(createLink(reject)),
      cache: new InMemoryCache({ addTypename: false }),
    });

    return client.query({ query }).then(
      () => client.query({ fetchPolicy: 'no-cache', query }).then(actualResult => {
        expect(actualResult.data).toEqual(result);
        expect(called).toBe(4);
      }),
    ).then(resolve, reject);
  });

  itAsync('does not save the data to the cache on success', (resolve, reject) => {
    let called = 0;
    const inspector = new ApolloLink((operation, forward) => {
      called++;
      return forward(operation).map(result => {
        called++;
        return result;
      });
    });

    const client = new ApolloClient({
      link: inspector.concat(createLink(reject)),
      cache: new InMemoryCache({ addTypename: false }),
    });

    return client.query({ query, fetchPolicy: 'no-cache' }).then(
      () => client.query({ query }).then(actualResult => {
        expect(stripSymbols(actualResult.data)).toEqual(result);
        // the second query couldn't read anything from the cache
        expect(called).toBe(4);
      }),
    ).then(resolve, reject);
  });

  itAsync('does not save data to the cache on failure', (resolve, reject) => {
    let called = 0;
    const inspector = new ApolloLink((operation, forward) => {
      called++;
      return forward(operation).map(result => {
        called++;
        return result;
      });
    });

    const client = new ApolloClient({
      link: inspector.concat(createFailureLink()),
      cache: new InMemoryCache({ addTypename: false }),
    });

    let didFail = false;
    return client
      .query({ query, fetchPolicy: 'no-cache' })
      .catch(e => {
        expect(e.message).toMatch('query failed');
        didFail = true;
      })
      .then(() => client.query({ query }).then(actualResult => {
        expect(stripSymbols(actualResult.data)).toEqual(result);
        // the first error doesn't call .map on the inspector
        expect(called).toBe(3);
        expect(didFail).toBe(true);
      }))
      .then(resolve, reject);
  });

  itAsync('does not update the cache on a mutation', (resolve, reject) => {
    const inspector = new ApolloLink((operation, forward) => {
      return forward(operation).map(result => {
        return result;
      });
    });

    const client = new ApolloClient({
      link: inspector.concat(createMutationLink(reject)),
      cache: new InMemoryCache({ addTypename: false }),
    });

    return client
      .query({ query })
      .then(() =>
        client.mutate({ mutation, variables, fetchPolicy: 'no-cache' }),
      )
      .then(() => {
        return client.query({ query }).then(actualResult => {
          expect(stripSymbols(actualResult.data)).toEqual(result);
        });
      })
      .then(resolve, reject);
  });

  describe('when notifyOnNetworkStatusChange is set', () => {
    itAsync('does not save the data to the cache on success', (resolve, reject) => {
      let called = 0;
      const inspector = new ApolloLink((operation, forward) => {
        called++;
        return forward(operation).map(result => {
          called++;
          return result;
        });
      });

      const client = new ApolloClient({
        link: inspector.concat(createLink(reject)),
        cache: new InMemoryCache({ addTypename: false }),
      });

      return client.query({ query, fetchPolicy: 'no-cache', notifyOnNetworkStatusChange: true }).then(
        () => client.query({ query }).then(actualResult => {
          expect(stripSymbols(actualResult.data)).toEqual(result);
          // the second query couldn't read anything from the cache
          expect(called).toBe(4);
        }),
      ).then(resolve, reject);
    });

    itAsync('does not save data to the cache on failure', (resolve, reject) => {
      let called = 0;
      const inspector = new ApolloLink((operation, forward) => {
        called++;
        return forward(operation).map(result => {
          called++;
          return result;
        });
      });

      const client = new ApolloClient({
        link: inspector.concat(createFailureLink()),
        cache: new InMemoryCache({ addTypename: false }),
      });

      let didFail = false;
      return client
        .query({ query, fetchPolicy: 'no-cache', notifyOnNetworkStatusChange: true })
        .catch(e => {
          expect(e.message).toMatch('query failed');
          didFail = true;
        })
        .then(() => client.query({ query }).then(actualResult => {
          expect(stripSymbols(actualResult.data)).toEqual(result);
          // the first error doesn't call .map on the inspector
          expect(called).toBe(3);
          expect(didFail).toBe(true);
        }))
        .then(resolve, reject);
    });

    itAsync('gives appropriate networkStatus for watched queries', (resolve, reject) => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache(),
        resolvers: {
          Query: {
            hero(_data, args) {
              return {
                __typename: 'Hero',
                ...args,
                name: 'Luke Skywalker',
              };
            },
          },
        },
      });

      const observable = client.watchQuery({
        query: gql`
          query FetchLuke($id: String) {
            hero(id: $id) @client {
              id
              name
            }
          }
        `,
        fetchPolicy: 'no-cache',
        variables: { id: '1' },
        notifyOnNetworkStatusChange: true,
      });

      function dataWithId(id: number | string) {
        return {
          hero: {
            __typename: 'Hero',
            id: String(id),
            name: 'Luke Skywalker',
          },
        };
      }

      subscribeAndCount(reject, observable, (count, result) => {
        if (count === 1) {
          expect(result).toEqual({
            data: dataWithId(1),
            loading: false,
            networkStatus: NetworkStatus.ready,
          });
          expect(client.cache.extract(true)).toEqual({});
          return observable.setVariables({ id: '2' });
        } else if (count === 2) {
          expect(result).toEqual({
            loading: true,
            networkStatus: NetworkStatus.setVariables,
            partial: true,
          });
        } else if (count === 3) {
          expect(result).toEqual({
            data: dataWithId(2),
            loading: false,
            networkStatus: NetworkStatus.ready,
          });
          expect(client.cache.extract(true)).toEqual({});
          return observable.refetch();
        } else if (count === 4) {
          expect(result).toEqual({
            data: dataWithId(2),
            loading: true,
            networkStatus: NetworkStatus.refetch,
          });
          expect(client.cache.extract(true)).toEqual({});
        } else if (count === 5) {
          expect(result).toEqual({
            data: dataWithId(2),
            loading: false,
            networkStatus: NetworkStatus.ready,
          });
          expect(client.cache.extract(true)).toEqual({});
          return observable.refetch({ id: '3' });
        } else if (count === 6) {
          expect(result).toEqual({
            loading: true,
            networkStatus: NetworkStatus.setVariables,
            partial: true,
          });
          expect(client.cache.extract(true)).toEqual({});
        } else if (count === 7) {
          expect(result).toEqual({
            data: dataWithId(3),
            loading: false,
            networkStatus: NetworkStatus.ready,
          });
          expect(client.cache.extract(true)).toEqual({});
          resolve();
        }
      });
    });
  });
});

describe('cache-first', () => {
  itAsync.skip('does not trigger network request during optimistic update', (resolve, reject) => {
    const results: any[] = [];
    const client = new ApolloClient({
      link: new ApolloLink((operation, forward) => {
        return forward(operation).map(result => {
          results.push(result);
          return result;
        });
      }).concat(createMutationLink(reject)),
      cache: new InMemoryCache,
    });

    let inOptimisticTransaction = false;

    subscribeAndCount(reject, client.watchQuery({
      query,
      fetchPolicy: "cache-and-network",
      returnPartialData: true,
    }), (count, { data, loading, networkStatus }) => {
      if (count === 1) {
        expect(results.length).toBe(0);
        expect(loading).toBe(true);
        expect(networkStatus).toBe(NetworkStatus.loading);
        expect(data).toEqual({});
      } else if (count === 2) {
        expect(results.length).toBe(1);
        expect(loading).toBe(false);
        expect(networkStatus).toBe(NetworkStatus.ready);
        expect(data).toEqual({
          author: {
            __typename: "Author",
            id: 1,
            firstName: "John",
            lastName: "Smith",
          },
        });

        inOptimisticTransaction = true;
        client.cache.recordOptimisticTransaction(cache => {
          cache.writeQuery({
            query,
            data: {
              author: {
                __typename: "Bogus",
              },
            },
          });
        }, "bogus");

      } else if (count === 3) {
        expect(results.length).toBe(1);
        expect(loading).toBe(false);
        expect(networkStatus).toBe(NetworkStatus.ready);
        expect(data).toEqual({
          author: {
            __typename: "Bogus",
          },
        });

        setTimeout(() => {
          inOptimisticTransaction = false;
          client.cache.removeOptimistic("bogus");
        }, 100);

      } else if (count === 4) {
        // A network request should not be triggered until after the bogus
        // optimistic transaction has been removed.
        expect(inOptimisticTransaction).toBe(false);
        expect(results.length).toBe(1);
        expect(loading).toBe(false);
        expect(networkStatus).toBe(NetworkStatus.ready);
        expect(data).toEqual({
          author: {
            __typename: "Author",
            id: 1,
            firstName: "John",
            lastName: "Smith",
          },
        });

        client.cache.writeQuery({
          query,
          data: {
            author: {
              __typename: "Author",
              id: 2,
              firstName: "Chinua",
              lastName: "Achebe",
            },
          },
        });

      } else if (count === 5) {
        expect(inOptimisticTransaction).toBe(false);
        expect(results.length).toBe(1);
        expect(loading).toBe(false);
        expect(networkStatus).toBe(NetworkStatus.ready);
        expect(data).toEqual({
          author: {
            __typename: "Author",
            id: 2,
            firstName: "Chinua",
            lastName: "Achebe",
          },
        });
        setTimeout(resolve, 100);
      } else {
        reject(new Error("unreached"));
      }
    });
  });
});

describe('cache-only', () => {
  itAsync('allows explicit refetch to happen', (resolve, reject) => {
    let counter = 0;
    const client = new ApolloClient({
      cache: new InMemoryCache,
      link: new ApolloLink(operation => new Observable(observer => {
        observer.next({
          data: {
            count: ++counter,
          },
        });
        observer.complete();
      })),
    });

    const query = gql`query { count }`;

    const observable = client.watchQuery({
      query,
      nextFetchPolicy: 'cache-only',
    });

    subscribeAndCount(reject, observable, (count, result) => {
      if (count === 1) {
        expect(result).toEqual({
          loading: false,
          networkStatus: NetworkStatus.ready,
          data: {
            count: 1,
          },
        });

        expect(observable.options.fetchPolicy).toBe('cache-only');

        observable.refetch().catch(reject);

      } else if (count === 2) {
        expect(result).toEqual({
          loading: false,
          networkStatus: NetworkStatus.ready,
          data: {
            count: 2,
          },
        });

        expect(observable.options.fetchPolicy).toBe('cache-only');

        setTimeout(resolve, 50);

      } else {
        reject(`too many results (${count})`);
      }
    });
  });
});

describe('cache-and-network', function() {
  itAsync('gives appropriate networkStatus for refetched queries', (resolve, reject) => {
    const client = new ApolloClient({
      link: ApolloLink.empty(),
      cache: new InMemoryCache(),
      resolvers: {
        Query: {
          hero(_data, args) {
            return {
              __typename: 'Hero',
              ...args,
              name: 'Luke Skywalker',
            };
          },
        },
      },
    });

    const observable = client.watchQuery({
      query: gql`
        query FetchLuke($id: String) {
          hero(id: $id) @client {
            id
            name
          }
        }
      `,
      fetchPolicy: 'cache-and-network',
      variables: { id: '1' },
      notifyOnNetworkStatusChange: true,
    });

    function dataWithId(id: number | string) {
      return {
        hero: {
          __typename: 'Hero',
          id: String(id),
          name: 'Luke Skywalker',
        },
      };
    }

    subscribeAndCount(reject, observable, (count, result) => {
      if (count === 1) {
        expect(result).toEqual({
          data: dataWithId(1),
          loading: false,
          networkStatus: NetworkStatus.ready,
        });
        return observable.setVariables({ id: '2' });
      } else if (count === 2) {
        expect(result).toEqual({
          data: {},
          loading: true,
          networkStatus: NetworkStatus.setVariables,
          partial: true,
        });
      } else if (count === 3) {
        expect(result).toEqual({
          data: dataWithId(2),
          loading: false,
          networkStatus: NetworkStatus.ready,
        });
        return observable.refetch();
      } else if (count === 4) {
        expect(result).toEqual({
          data: dataWithId(2),
          loading: true,
          networkStatus: NetworkStatus.refetch,
        });
      } else if (count === 5) {
        expect(result).toEqual({
          data: dataWithId(2),
          loading: false,
          networkStatus: NetworkStatus.ready,
        });
        return observable.refetch({ id: '3' });
      } else if (count === 6) {
        expect(result).toEqual({
          data: {},
          loading: true,
          networkStatus: NetworkStatus.setVariables,
          partial: true,
        });
      } else if (count === 7) {
        expect(result).toEqual({
          data: dataWithId(3),
          loading: false,
          networkStatus: NetworkStatus.ready,
        });
        resolve();
      }
    });
  });
});
