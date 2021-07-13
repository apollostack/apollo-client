import gql from 'graphql-tag';
import { DocumentNode, ExecutionResult } from 'graphql';
import { assign } from 'lodash';

import { LocalState } from '../../core/LocalState';

import {
  ApolloClient,
  ApolloQueryResult,
  Resolvers,
  WatchQueryOptions,
} from '../../core';

import { InMemoryCache } from '../../cache';
import { Observable, Observer } from '../../utilities';
import { ApolloLink } from '../../link/core';
import { itAsync } from '../../testing';
import mockQueryManager from '../../utilities/testing/mocking/mockQueryManager';
import wrap from '../../utilities/testing/wrap';

// Helper method that sets up a mockQueryManager and then passes on the
// results to an observer.
const assertWithObserver = ({
  reject,
  resolvers,
  query,
  serverQuery,
  variables = {},
  queryOptions = {},
  serverResult,
  error,
  delay,
  observer,
}: {
  reject: (reason: any) => any;
  resolvers?: Resolvers;
  query: DocumentNode;
  serverQuery?: DocumentNode;
  variables?: object;
  queryOptions?: object;
  error?: Error;
  serverResult?: ExecutionResult;
  delay?: number;
  observer: Observer<ApolloQueryResult<any>>;
}) => {
  const queryManager = mockQueryManager(reject, {
    request: { query: serverQuery || query, variables },
    result: serverResult,
    error,
    delay,
  });

  if (resolvers) {
    queryManager.getLocalState().addResolvers(resolvers);
  }

  const finalOptions = assign(
    { query, variables },
    queryOptions,
  ) as WatchQueryOptions;
  return queryManager.watchQuery<any>(finalOptions).subscribe({
    next: wrap(reject, observer.next!),
    error: observer.error,
  });
};

describe('Basic resolver capabilities', () => {
  itAsync('should run resolvers for @client queries', (resolve, reject) => {
    const query = gql`
      query Test {
        foo @client {
          bar
        }
      }
    `;

    const resolvers = {
      Query: {
        foo: () => ({ bar: true }),
      },
    };

    assertWithObserver({
      reject,
      resolvers,
      query,
      observer: {
        next({ data }) {
          try {
            expect(data).toEqual({ foo: { bar: true } });
          } catch (error) {
            reject(error);
          }
          resolve();
        },
      },
    });
  });

  itAsync('should handle queries with a mix of @client and server fields', (resolve, reject) => {
    const query = gql`
      query Mixed {
        foo @client {
          bar
        }
        bar {
          baz
        }
      }
    `;

    const serverQuery = gql`
      query Mixed {
        bar {
          baz
        }
      }
    `;

    const resolvers = {
      Query: {
        foo: () => ({ bar: true }),
      },
    };

    assertWithObserver({
      reject,
      resolvers,
      query,
      serverQuery,
      serverResult: { data: { bar: { baz: true } } },
      observer: {
        next({ data }) {
          try {
            expect(data).toEqual({ foo: { bar: true }, bar: { baz: true } });
          } catch (error) {
            reject(error);
          }
          resolve();
        },
      },
    });
  });

  itAsync('should handle a mix of @client fields with fragments and server fields', (resolve, reject) => {
    const query = gql`
      fragment client on ClientData {
        bar
        __typename
      }

      query Mixed {
        foo @client {
          ...client
        }
        bar {
          baz
        }
      }
    `;

    const serverQuery = gql`
      query Mixed {
        bar {
          baz
        }
      }
    `;

    const resolvers = {
      Query: {
        foo: () => ({ bar: true, __typename: 'ClientData' }),
      },
    };

    assertWithObserver({
      reject,
      resolvers,
      query,
      serverQuery,
      serverResult: { data: { bar: { baz: true, __typename: 'Bar' } } },
      observer: {
        next({ data }) {
          try {
            expect(data).toEqual({
              foo: { bar: true, __typename: 'ClientData' },
              bar: { baz: true },
            });
          } catch (error) {
            reject(error);
          }
          resolve();
        },
      },
    });
  });

  itAsync('should have access to query variables when running @client resolvers', (resolve, reject) => {
    const query = gql`
      query WithVariables($id: ID!) {
        foo @client {
          bar(id: $id)
        }
      }
    `;

    const resolvers = {
      Query: {
        foo: () => ({ __typename: 'Foo' }),
      },
      Foo: {
        bar: (_data: any, { id }: { id: number }) => id,
      },
    };

    assertWithObserver({
      reject,
      resolvers,
      query,
      variables: { id: 1 },
      observer: {
        next({ data }) {
          try {
            expect(data).toEqual({ foo: { bar: 1 } });
          } catch (error) {
            reject(error);
          }
          resolve();
        },
      },
    });
  });

  itAsync('should pass context to @client resolvers', (resolve, reject) => {
    const query = gql`
      query WithContext {
        foo @client {
          bar
        }
      }
    `;

    const resolvers = {
      Query: {
        foo: () => ({ __typename: 'Foo' }),
      },
      Foo: {
        bar: (_data: any, _args: any, { id }: { id: number }) => id,
      },
    };

    assertWithObserver({
      reject,
      resolvers,
      query,
      queryOptions: { context: { id: 1 } },
      observer: {
        next({ data }) {
          try {
            expect(data).toEqual({ foo: { bar: 1 } });
          } catch (error) {
            reject(error);
          }
          resolve();
        },
      },
    });
  });

  itAsync(
    'should combine local @client resolver results with server results, for ' +
      'the same field',
    (resolve, reject) => {
      const query = gql`
        query author {
          author {
            name
            stats {
              totalPosts
              postsToday @client
            }
          }
        }
      `;

      const serverQuery = gql`
        query author {
          author {
            name
            stats {
              totalPosts
            }
          }
        }
      `;

      const resolvers = {
        Stats: {
          postsToday: () => 10,
        },
      };

      assertWithObserver({
        reject,
        resolvers,
        query,
        serverQuery,
        serverResult: {
          data: {
            author: {
              name: 'John Smith',
              stats: {
                totalPosts: 100,
                __typename: 'Stats',
              },
              __typename: 'Author',
            },
          },
        },
        observer: {
          next({ data }) {
            try {
              expect(data).toEqual({
                author: {
                  name: 'John Smith',
                  stats: {
                    totalPosts: 100,
                    postsToday: 10,
                  },
                },
              });
            } catch (error) {
              reject(error);
            }
            resolve();
          },
        },
      });
    },
  );

  itAsync('should handle resolvers that work with booleans properly', (resolve, reject) => {
    const query = gql`
      query CartDetails {
        isInCart @client
      }
    `;

    const cache = new InMemoryCache();
    cache.writeQuery({ query, data: { isInCart: true } });

    const client = new ApolloClient({
      cache,
      resolvers: {
        Query: {
          isInCart: () => false,
        },
      },
    });

    return client
      .query({ query, fetchPolicy: 'network-only' })
      .then(({ data }: any) => {
        expect({ ...data }).toMatchObject({
          isInCart: false,
        });
        resolve();
      });
  });

  it('should handle nested asynchronous @client resolvers (issue #4841)', () => {
    const query = gql`
      query DeveloperTicketComments($id: ID) {
        developer(id: $id) @client {
          id
          handle
          tickets @client {
            id
            comments @client {
              id
            }
          }
        }
      }
    `;

    function randomDelay(range: number) {
      return new Promise(resolve =>
        setTimeout(resolve, Math.round(Math.random() * range)),
      );
    }

    function uuid() {
      return Math.random()
        .toString(36)
        .slice(2);
    }

    const developerId = uuid();

    function times<T>(n: number, thunk: () => T): Promise<T[]> {
      const result: T[] = [];
      for (let i = 0; i < n; ++i) {
        result.push(thunk());
      }
      return Promise.all(result);
    }

    const ticketsPerDev = 5;
    const commentsPerTicket = 5;

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      resolvers: {
        Query: {
          async developer(_, { id }) {
            await randomDelay(50);
            expect(id).toBe(developerId);
            return {
              __typename: 'Developer',
              id,
              handle: '@benjamn',
            };
          },
        },
        Developer: {
          async tickets(developer) {
            await randomDelay(50);
            expect(developer.__typename).toBe('Developer');
            return times(ticketsPerDev, () => ({
              __typename: 'Ticket',
              id: uuid(),
            }));
          },
        },
        Ticket: {
          async comments(ticket) {
            await randomDelay(50);
            expect(ticket.__typename).toBe('Ticket');
            return times(commentsPerTicket, () => ({
              __typename: 'Comment',
              id: uuid(),
            }));
          },
        },
      },
    });

    function check(result: ApolloQueryResult<any>) {
      return new Promise<void>(resolve => {
        expect(result.data.developer.id).toBe(developerId);
        expect(result.data.developer.handle).toBe('@benjamn');
        expect(result.data.developer.tickets.length).toBe(ticketsPerDev);
        const commentIds = new Set<string>();
        result.data.developer.tickets.forEach((ticket: any) => {
          expect(ticket.__typename).toBe('Ticket');
          expect(ticket.comments.length).toBe(commentsPerTicket);
          ticket.comments.forEach((comment: any) => {
            expect(comment.__typename).toBe('Comment');
            commentIds.add(comment.id);
          });
        });
        expect(commentIds.size).toBe(ticketsPerDev * commentsPerTicket);
        resolve();
      });
    }

    return Promise.all([
      new Promise((resolve, reject) => {
        client
          .watchQuery({
            query,
            variables: {
              id: developerId,
            },
          })
          .subscribe({
            next(result) {
              check(result).then(resolve, reject);
            },
            error: reject,
          });
      }),
      client
        .query({
          query,
          variables: {
            id: developerId,
          },
        })
        .then(check),
    ]);
  });
});

describe('Writing cache data from resolvers', () => {
  it('should let you write to the cache with a mutation', () => {
    const query = gql`
      {
        field @client
      }
    `;

    const mutation = gql`
      mutation start {
        start @client
      }
    `;

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: ApolloLink.empty(),
      resolvers: {
        Mutation: {
          start(_data, _args, { cache }) {
            cache.writeQuery({ query, data: { field: 1 } });
            return { start: true };
          },
        },
      },
    });

    return client
      .mutate({ mutation })
      .then(() => client.query({ query }))
      .then(({ data }) => {
        expect({ ...data }).toMatchObject({ field: 1 });
      });
  });

  it('should let you write to the cache with a mutation using an ID', () => {
    const query = gql`
      {
        obj @client {
          field
        }
      }
    `;

    const mutation = gql`
      mutation start {
        start @client
      }
    `;

    const cache = new InMemoryCache();

    const client = new ApolloClient({
      cache,
      link: ApolloLink.empty(),
      resolvers: {
        Mutation: {
          start() {
            cache.writeQuery({
              query,
              data: {
                obj: { field: 1, id: 'uniqueId', __typename: 'Object' },
              },
            });

            cache.modify({
              id: 'Object:uniqueId',
              fields: {
                field(value) {
                  expect(value).toBe(1);
                  return 2;
                },
              },
            });

            return { start: true };
          },
        },
      },
    });

    return client
      .mutate({ mutation })
      .then(() => client.query({ query }))
      .then(({ data }: any) => {
        expect(data.obj.field).toEqual(2);
      });
  });

  it('should not overwrite __typename when writing to the cache with an id', () => {
    const query = gql`
      {
        obj @client {
          field {
            field2
          }
          id
        }
      }
    `;

    const mutation = gql`
      mutation start {
        start @client
      }
    `;

    const cache = new InMemoryCache();

    const client = new ApolloClient({
      cache,
      link: ApolloLink.empty(),
      resolvers: {
        Mutation: {
          start() {
            cache.writeQuery({
              query,
              data: {
                obj: {
                  field: { field2: 1, __typename: 'Field' },
                  id: 'uniqueId',
                  __typename: 'Object',
                },
              },
            });
            cache.modify({
              id: 'Object:uniqueId',
              fields: {
                field(value: { field2: number }) {
                  expect(value.field2).toBe(1);
                  return { ...value, field2: 2 };
                },
              },
            })
            return { start: true };
          },
        },
      },
    });

    return client
      .mutate({ mutation })
      .then(() => client.query({ query }))
      .then(({ data }: any) => {
        expect(data.obj.__typename).toEqual('Object');
        expect(data.obj.field.__typename).toEqual('Field');
      })
      .catch(e => console.log(e));
  });
});

describe('Resolving field aliases', () => {
  itAsync('should run resolvers for missing client queries with aliased field', (resolve, reject) => {
    // expect.assertions(1);
    const query = gql`
      query Aliased {
        foo @client {
          bar
        }
        baz: bar {
          foo
        }
      }
    `;

    const link = new ApolloLink(() =>
      // Each link is responsible for implementing their own aliasing so it
      // returns baz not bar
      Observable.of({ data: { baz: { foo: true, __typename: 'Baz' } } }),
    );

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link,
      resolvers: {
        Query: {
          foo: () => ({ bar: true, __typename: 'Foo' }),
        },
      },
    });

    client.query({ query }).then(({ data }) => {
      try {
        expect(data).toEqual({
          foo: { bar: true, __typename: 'Foo' },
          baz: { foo: true, __typename: 'Baz' },
        });
      } catch (e) {
        reject(e);
        return;
      }
      resolve();
    }, reject);
  });

  itAsync(
    'should run resolvers for client queries when aliases are in use on ' +
      'the @client-tagged node',
    (resolve, reject) => {
      const aliasedQuery = gql`
        query Test {
          fie: foo @client {
            bar
          }
        }
      `;

      const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: ApolloLink.empty(),
        resolvers: {
          Query: {
            foo: () => ({ bar: true, __typename: 'Foo' }),
            fie: () => {
              reject(
                "Called the resolver using the alias' name, instead of " +
                  'the correct resolver name.',
              );
            },
          },
        },
      });

      client.query({ query: aliasedQuery }).then(({ data }) => {
        expect(data).toEqual({ fie: { bar: true, __typename: 'Foo' } });
        resolve();
      }, reject);
    },
  );

  itAsync('should respect aliases for *nested fields* on the @client-tagged node', (resolve, reject) => {
    const aliasedQuery = gql`
      query Test {
        fie: foo @client {
          fum: bar
        }
        baz: bar {
          foo
        }
      }
    `;

    const link = new ApolloLink(() =>
      Observable.of({ data: { baz: { foo: true, __typename: 'Baz' } } }),
    );

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link,
      resolvers: {
        Query: {
          foo: () => ({ bar: true, __typename: 'Foo' }),
          fie: () => {
            reject(
              "Called the resolver using the alias' name, instead of " +
                'the correct resolver name.',
            );
          },
        },
      },
    });

    client.query({ query: aliasedQuery }).then(({ data }) => {
      expect(data).toEqual({
        fie: { fum: true, __typename: 'Foo' },
        baz: { foo: true, __typename: 'Baz' },
      });
      resolve();
    }, reject);
  });

  it(
    'should pull initialized values for aliased fields tagged with @client ' +
      'from the cache',
    () => {
      const query = gql`
        {
          fie: foo @client {
            bar
          }
        }
      `;

      const cache = new InMemoryCache();
      const client = new ApolloClient({
        cache,
        link: ApolloLink.empty(),
        resolvers: {},
      });

      cache.writeQuery({
        query: gql`{ foo { bar }}`,
        data: {
          foo: {
            bar: 'yo',
            __typename: 'Foo',
          },
        },
      });

      return client.query({ query }).then(({ data }) => {
        expect({ ...data }).toMatchObject({
          fie: { bar: 'yo', __typename: 'Foo' },
        });
      });
    },
  );

  it(
    'should resolve @client fields using local resolvers and not have ' +
    'their value overridden when a fragment is loaded',
    () => {
      const query = gql`
        fragment LaunchDetails on Launch {
          id
          __typename
        }
        query Launch {
          launch {
            isInCart @client
            ...LaunchDetails
          }
        }
      `;

      const link = new ApolloLink(() =>
        Observable.of({
          data: {
            launch: {
              id: 1,
              __typename: 'Launch',
            },
          },
        }),
      );

      const client = new ApolloClient({
        cache: new InMemoryCache(),
        link,
        resolvers: {
          Launch: {
            isInCart() {
              return true;
            },
          },
        },
      });

      client.writeQuery({
        query: gql`{ launch { isInCart }}`,
        data: {
          launch: {
            isInCart: false,
            __typename: 'Launch',
          },
        },
      });

      return client.query({ query }).then(({ data }) => {
        // `isInCart` resolver is fired, returning `true` (which is then
        // stored in the cache).
        expect(data.launch.isInCart).toBe(true);
      }).then(() => {
        client.query({ query }).then(({ data }) => {
          // When the same query fires again, `isInCart` should be pulled from
          // the cache and have a value of `true`.
          expect(data.launch.isInCart).toBe(true);
        });
      });
    }
  );
});

describe('Force local resolvers', () => {
  it(
    'should force the running of local resolvers marked with ' +
    '`@client(always: true)` when using `ApolloClient.query`',
    async () => {
      const query = gql`
        query Author {
          author {
            name
            isLoggedIn @client(always: true)
          }
        }
      `;

      const cache = new InMemoryCache();
      const client = new ApolloClient({
        cache,
        link: ApolloLink.empty(),
        resolvers: {},
      });

      cache.writeQuery({
        query,
        data: {
          author: {
            name: 'John Smith',
            isLoggedIn: false,
            __typename: 'Author',
          },
        },
      });

      // When the resolver isn't defined, there isn't anything to force, so
      // make sure the query resolves from the cache properly.
      const { data: data1 } = await client.query({ query });
      expect(data1.author.isLoggedIn).toEqual(false);

      client.addResolvers({
        Author: {
          isLoggedIn() {
            return true;
          },
        },
      });

      // A resolver is defined, so make sure it's forced, and the result
      // resolves properly as a combination of cache and local resolver
      // data.
      const { data: data2 } = await client.query({ query });
      expect(data2.author.isLoggedIn).toEqual(true);
    },
  );

  it(
    'should avoid running forced resolvers a second time when ' +
    'loading results over the network (so not from the cache)',
    async () => {
      const query = gql`
        query Author {
          author {
            name
            isLoggedIn @client(always: true)
          }
        }
      `;

      const link = new ApolloLink(() =>
        Observable.of({
          data: {
            author: {
              name: 'John Smith',
              __typename: 'Author'
            },
          },
        }),
      );

      let count = 0;
      const client = new ApolloClient({
        cache: new InMemoryCache(),
        link,
        resolvers: {
          Author: {
            isLoggedIn() {
              count += 1;
              return true;
            },
          },
        },
      });

      const { data } = await client.query({ query });
      expect(data.author.isLoggedIn).toEqual(true);
      expect(count).toEqual(1);
    },
  );

  it(
    'should only force resolvers for fields marked with ' +
    '`@client(always: true)`, not all `@client` fields',
    async () => {
      const query = gql`
        query UserDetails {
          name @client
          isLoggedIn @client(always: true)
        }
      `;

      let nameCount = 0;
      let isLoggedInCount = 0;
      const client = new ApolloClient({
        cache: new InMemoryCache(),
        resolvers: {
          Query: {
            name() {
              nameCount += 1;
              return 'John Smith';
            },
            isLoggedIn() {
              isLoggedInCount += 1;
              return true;
            },
          },
        },
      });

      await client.query({ query });
      expect(nameCount).toEqual(1);
      expect(isLoggedInCount).toEqual(1);

      // On the next request, `name` will be loaded from the cache only,
      // whereas `isLoggedIn` will be loaded from the cache then overwritten
      // by running its forced local resolver.
      await client.query({ query });
      expect(nameCount).toEqual(1);
      expect(isLoggedInCount).toEqual(2);
    },
  );

  itAsync(
    'should force the running of local resolvers marked with ' +
    '`@client(always: true)` when using `ApolloClient.watchQuery`',
    (resolve, reject) => {
      const query = gql`
        query IsUserLoggedIn {
          isUserLoggedIn @client(always: true)
        }
      `;

      const queryNoForce = gql`
        query IsUserLoggedIn {
          isUserLoggedIn @client
        }
      `;

      let callCount = 0;
      const client = new ApolloClient({
        cache: new InMemoryCache(),
        resolvers: {
          Query: {
            isUserLoggedIn() {
              callCount += 1;
              return true;
            }
          }
        },
      });

      client.watchQuery({ query }).subscribe({
        next() {
          expect(callCount).toBe(1);

          client.watchQuery({ query }).subscribe({
            next() {
              expect(callCount).toBe(2);

              client.watchQuery({ query: queryNoForce }).subscribe({
                next() {
                  // Result is loaded from the cache since the resolver
                  // isn't being forced.
                  expect(callCount).toBe(2);
                  resolve();
                }
              });
            }
          });
        }
      });
    },
  );

  it('should allow client-only virtual resolvers (#4731)', function() {
    const query = gql`
      query UserData {
        userData @client {
          firstName
          lastName
          fullName
        }
      }
    `;

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      resolvers: {
        Query: {
          userData() {
            return {
              __typename: 'User',
              firstName: 'Ben',
              lastName: 'Newman',
            };
          },
        },
        User: {
          fullName(data) {
            return data.firstName + ' ' + data.lastName;
          },
        },
      },
    });

    return client.query({ query }).then(result => {
      expect(result.data).toEqual({
        userData: {
          __typename: 'User',
          firstName: 'Ben',
          lastName: 'Newman',
          fullName: 'Ben Newman',
        },
      });
    });
  });
});

describe('Async resolvers', () => {
  itAsync('should support async @client resolvers', async (resolve, reject) => {
    const query = gql`
      query Member {
        isLoggedIn @client
      }
    `;

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      resolvers: {
        Query: {
          isLoggedIn() {
            return Promise.resolve(true);
          },
        },
      },
    });

    const { data: { isLoggedIn } } = await client.query({ query })!;
    expect(isLoggedIn).toBe(true);
    return resolve();
  });

  itAsync(
    'should support async @client resolvers mixed with remotely resolved data',
    async (resolve, reject) => {
      const query = gql`
        query Member {
          member {
            name
            sessionCount @client
            isLoggedIn @client
          }
        }
      `;

      const testMember = {
        name: 'John Smithsonian',
        isLoggedIn: true,
        sessionCount: 10,
      }

      const link = new ApolloLink(() =>
        Observable.of({
          data: {
            member: {
              name: testMember.name,
              __typename: 'Member'
            }
          }
        }),
      );

      const client = new ApolloClient({
        cache: new InMemoryCache(),
        link,
        resolvers: {
          Member: {
            isLoggedIn() {
              return Promise.resolve(testMember.isLoggedIn);
            },
            sessionCount() {
              return testMember.sessionCount;
            },
          },
        },
      });

      const { data: { member } } = await client.query({ query })!;
      expect(member.name).toBe(testMember.name);
      expect(member.isLoggedIn).toBe(testMember.isLoggedIn);
      expect(member.sessionCount).toBe(testMember.sessionCount);
      return resolve();
    },
  );
});

describe('LocalState helpers', () => {
  describe('#shouldForceResolvers', () => {
    it(
      'should return true if the document contains any @client directives ' +
      'with an `always` variable of true',
      () => {
        const localState = new LocalState({ cache: new InMemoryCache() });
        const query = gql`
          query Author {
            name
            isLoggedIn @client(always: true)
          }
        `;
        expect(localState.shouldForceResolvers(query)).toBe(true);
      }
    );

    it(
      'should return false if the document contains any @client directives ' +
      'without an `always` variable',
      () => {
        const localState = new LocalState({ cache: new InMemoryCache() });
        const query = gql`
          query Author {
            name
            isLoggedIn @client
          }
        `;
        expect(localState.shouldForceResolvers(query)).toBe(false);
      }
    );

    it(
      'should return false if the document contains any @client directives ' +
      'with an `always` variable of false',
      () => {
        const localState = new LocalState({ cache: new InMemoryCache() });
        const query = gql`
          query Author {
            name
            isLoggedIn @client(always: false)
          }
        `;
        expect(localState.shouldForceResolvers(query)).toBe(false);
      }
    );
  });
});
