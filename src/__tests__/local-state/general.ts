import gql from 'graphql-tag';
import { DocumentNode, GraphQLError, getIntrospectionQuery } from 'graphql';

import { Observable } from '../../utilities';
import { ApolloLink } from '../../link/core';
import { Operation } from '../../link/core';
import { ApolloClient } from '../../core';
import { ApolloCache, InMemoryCache } from '../../cache';
import { itAsync, withErrorSpy } from '../../testing';

describe('General functionality', () => {
  it('should not impact normal non-@client use', () => {
    const query = gql`
      {
        field
      }
    `;

    const link = new ApolloLink(() => Observable.of({ data: { field: 1 } }));
    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link,
      resolvers: {
        Query: {
          count: () => 0,
        },
      },
    });

    return client.query({ query }).then(({ data }) => {
      expect({ ...data }).toMatchObject({ field: 1 });
    });
  });

  it('should not interfere with server introspection queries', () => {
    const query = gql`
      ${getIntrospectionQuery()}
    `;

    const error = new GraphQLError('no introspection result found');
    const link = new ApolloLink(() => Observable.of({ errors: [error] }));

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link,
      resolvers: {
        Query: {
          count: () => 0,
        },
      },
    });

    return client
      .query({ query })
      .then(() => {
        throw new global.Error('should not call');
      })
      .catch((error: GraphQLError) =>
        expect(error.message).toMatch(/no introspection/),
      );
  });

  it('should support returning default values from resolvers', () => {
    const query = gql`
      {
        field @client
      }
    `;

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: ApolloLink.empty(),
      resolvers: {
        Query: {
          field: () => 1,
        },
      },
    });

    return client.query({ query }).then(({ data }) => {
      expect({ ...data }).toMatchObject({ field: 1 });
    });
  });

  it('should cache data for future lookups', () => {
    const query = gql`
      {
        field @client
      }
    `;

    let count = 0;
    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: ApolloLink.empty(),
      resolvers: {
        Query: {
          field: () => {
            count += 1;
            return 1;
          },
        },
      },
    });

    return client
      .query({ query })
      .then(({ data }) => {
        expect({ ...data }).toMatchObject({ field: 1 });
        expect(count).toBe(1);
      })
      .then(() =>
        client.query({ query }).then(({ data }) => {
          expect({ ...data }).toMatchObject({ field: 1 });
          expect(count).toBe(1);
        }),
      );
  });

  it('should honour `fetchPolicy` settings', () => {
    const query = gql`
      {
        field @client
      }
    `;

    let count = 0;
    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: ApolloLink.empty(),
      resolvers: {
        Query: {
          field: () => {
            count += 1;
            return 1;
          },
        },
      },
    });

    return client
      .query({ query })
      .then(({ data }) => {
        expect({ ...data }).toMatchObject({ field: 1 });
        expect(count).toBe(1);
      })
      .then(() =>
        client
          .query({ query, fetchPolicy: 'network-only' })
          .then(({ data }) => {
            expect({ ...data }).toMatchObject({ field: 1 });
            expect(count).toBe(2);
          }),
      );
  });

  it('should work with a custom fragment matcher', () => {
    const query = gql`
      {
        foo {
          ... on Bar {
            bar @client
          }
          ... on Baz {
            baz @client
          }
        }
      }
    `;

    const link = new ApolloLink(() =>
      Observable.of({
        data: { foo: [{ __typename: 'Bar' }, { __typename: 'Baz' }] },
      }),
    );

    const resolvers = {
      Bar: {
        bar: () => 'Bar',
      },
      Baz: {
        baz: () => 'Baz',
      },
    };

    const fragmentMatcher = (
      { __typename }: { __typename: string },
      typeCondition: string,
    ) => __typename === typeCondition;

    const client = new ApolloClient({
      cache: new InMemoryCache({
        possibleTypes: {
          Foo: ['Bar', 'Baz'],
        },
      }),
      link,
      resolvers,
      fragmentMatcher,
    });

    return client.query({ query }).then(({ data }) => {
      expect(data).toMatchObject({ foo: [{ bar: 'Bar' }, { baz: 'Baz' }] });
    });
  });
});

describe('Cache manipulation', () => {
  it(
    'should be able to query @client fields and the cache without defining ' +
      'local resolvers',
    () => {
      const query = gql`
        {
          field @client
        }
      `;

      const cache = new InMemoryCache();
      const client = new ApolloClient({
        cache,
        link: ApolloLink.empty(),
        resolvers: {},
      });

      cache.writeQuery({ query, data: { field: 'yo' } });

      client
        .query({ query })
        .then(({ data }) => expect({ ...data }).toMatchObject({ field: 'yo' }));
    },
  );

  it('should be able to write to the cache using a local mutation', () => {
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

    const resolvers = {
      Mutation: {
        start: (_1: any, _2: any, { cache }: { cache: InMemoryCache }) => {
          cache.writeQuery({ query, data: { field: 1 } });
          return { start: true };
        },
      },
    };

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: ApolloLink.empty(),
      resolvers,
    });

    return client
      .mutate({ mutation })
      .then(() => client.query({ query }))
      .then(({ data }) => {
        expect({ ...data }).toMatchObject({ field: 1 });
      });
  });

  itAsync(
    'should be able to write to the cache with a local mutation and have ' +
      'things rerender automatically',
    (resolve, reject) => {
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

      const resolvers = {
        Query: {
          field: () => 0,
        },
        Mutation: {
          start: (_1: any, _2: any, { cache }: { cache: InMemoryCache }) => {
            cache.writeQuery({ query, data: { field: 1 } });
            return { start: true };
          },
        },
      };

      const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: ApolloLink.empty(),
        resolvers,
      });

      let count = 0;
      client.watchQuery({ query }).subscribe({
        next: ({ data }) => {
          count++;
          if (count === 1) {
            expect({ ...data }).toMatchObject({ field: 0 });
            client.mutate({ mutation });
          }

          if (count === 2) {
            expect({ ...data }).toMatchObject({ field: 1 });
            resolve();
          }
        },
      });
    },
  );

  it('should support writing to the cache with a local mutation using variables', () => {
    const query = gql`
      {
        field @client
      }
    `;

    const mutation = gql`
      mutation start($id: ID!) {
        start(field: $id) @client {
          field
        }
      }
    `;

    const resolvers = {
      Mutation: {
        start: (
          _1: any,
          variables: { field: string },
          { cache }: { cache: ApolloCache<any> },
        ) => {
          cache.writeQuery({ query, data: { field: variables.field } });
          return {
            __typename: 'Field',
            field: variables.field,
          };
        },
      },
    };

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: ApolloLink.empty(),
      resolvers,
    });

    return client
      .mutate({ mutation, variables: { id: '1234' } })
      .then(({ data }) => {
        expect({ ...data }).toEqual({
          start: { field: '1234', __typename: 'Field' },
        });
      })
      .then(() => client.query({ query }))
      .then(({ data }) => {
        expect({ ...data }).toMatchObject({ field: '1234' });
      });
  });

  itAsync("should read @client fields from cache on refetch (#4741)", (resolve, reject) => {
    const query = gql`
      query FetchInitialData {
        serverData {
          id
          title
        }
        selectedItemId @client
      }
    `;

    const mutation = gql`
      mutation Select {
        select(itemId: $id) @client
      }
    `;

    const serverData = {
      __typename: "ServerData",
      id: 123,
      title: "Oyez and Onoz",
    };

    let selectedItemId = -1;
    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: new ApolloLink(() => Observable.of({ data: { serverData } })),
      resolvers: {
        Query: {
          selectedItemId() {
            return selectedItemId;
          },
        },
        Mutation: {
          select(_, { itemId }) {
            selectedItemId = itemId;
          }
        }
      },
    });

    client.watchQuery({ query }).subscribe({
      next(result) {
        expect(result).toEqual({
          data: {
            serverData,
            selectedItemId,
          },
          loading: false,
          networkStatus: 7,
        });

        if (selectedItemId !== 123) {
          client.mutate({
            mutation,
            variables: {
              id: 123,
            },
            refetchQueries: [
              "FetchInitialData",
            ],
          });
        } else {
          resolve();
        }
      },
    });
  });

  itAsync("should rerun @client(always: true) fields on entity update", (resolve, reject) => {
    const query = gql`
      query GetClientData($id: ID) {
        clientEntity(id: $id) @client(always: true) {
          id
          title
          titleLength @client(always: true)
        }
      }
    `;

    const mutation = gql`
      mutation AddOrUpdate {
        addOrUpdate(id: $id, title: $title) @client
      }
    `;

    const fragment = gql`
    fragment ClientDataFragment on ClientData {
      id
      title
    }
    `
    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: new ApolloLink(() => Observable.of({ data: { } })),
      resolvers: {
        ClientData: {
          titleLength(data) {
            return data.title.length
          }
        },
        Query: {
          clientEntity(_root, {id}, {cache}) {
            return cache.readFragment({
              id: cache.identify({id, __typename: "ClientData"}),
              fragment,
            });
          },
        },
        Mutation: {
          addOrUpdate(_root, {id, title}, {cache}) {
            return cache.writeFragment({
              id: cache.identify({id, __typename: "ClientData"}),
              fragment,
              data: {id, title, __typename: "ClientData"},
            });
          },
        }
      },
    });

    const entityId = 1;
    const shortTitle = "Short";
    const longerTitle = "A little longer";
    client.mutate({
      mutation,
      variables: {
        id: entityId,
        title: shortTitle,
      },
    });
    let mutated = false;
    client.watchQuery({ query, variables: {id: entityId}}).subscribe({
      next(result) {
        if (!mutated) {
          expect(result.data.clientEntity).toEqual({
            id: entityId,
            title: shortTitle,
            titleLength: shortTitle.length,
            __typename: "ClientData",
          });
          client.mutate({
            mutation,
            variables: {
              id: entityId,
              title: longerTitle,
            }
          });
          mutated = true;
        } else if (mutated) {
          expect(result.data.clientEntity).toEqual({
            id: entityId,
            title: longerTitle,
            titleLength: longerTitle.length,
            __typename: "ClientData",
          });
          resolve();
        }
      },
    });
  });
});

describe('Sample apps', () => {
  itAsync('should support a simple counter app using local state', (resolve, reject) => {
    const query = gql`
      query GetCount {
        count @client
        lastCount # stored in db on server
      }
    `;

    const increment = gql`
      mutation Increment($amount: Int = 1) {
        increment(amount: $amount) @client
      }
    `;

    const decrement = gql`
      mutation Decrement($amount: Int = 1) {
        decrement(amount: $amount) @client
      }
    `;

    const link = new ApolloLink(operation => {
      expect(operation.operationName).toBe('GetCount');
      return Observable.of({ data: { lastCount: 1 } });
    });

    const client = new ApolloClient({
      link,
      cache: new InMemoryCache(),
      resolvers: {},
    });

    const update = (
      query: DocumentNode,
      updater: (data: { count: number }, variables: { amount: number }) => any,
    ) => {
      return (
        _result: {},
        variables: { amount: number },
        { cache }: { cache: ApolloCache<any> },
      ): null => {
        const read = client.readQuery<{ count: number }>({ query, variables });
        if (read) {
          const data = updater(read, variables);
          cache.writeQuery({ query, variables, data });
        } else {
          throw new Error('readQuery returned a falsy value');
        }
        return null;
      };
    };

    const resolvers = {
      Query: {
        count: () => 0,
      },
      Mutation: {
        increment: update(query, ({ count, ...rest }, { amount }) => ({
          ...rest,
          count: count + amount,
        })),
        decrement: update(query, ({ count, ...rest }, { amount }) => ({
          ...rest,
          count: count - amount,
        })),
      },
    };

    client.addResolvers(resolvers);

    let count = 0;
    client.watchQuery({ query }).subscribe({
      next: ({ data }) => {
        count++;
        if (count === 1) {
          try {
            expect({ ...data }).toMatchObject({ count: 0, lastCount: 1 });
          } catch (e) {
            reject(e);
          }
          client.mutate({ mutation: increment, variables: { amount: 2 } });
        }

        if (count === 2) {
          try {
            expect({ ...data }).toMatchObject({ count: 2, lastCount: 1 });
          } catch (e) {
            reject(e);
          }
          client.mutate({ mutation: decrement, variables: { amount: 1 } });
        }
        if (count === 3) {
          try {
            expect({ ...data }).toMatchObject({ count: 1, lastCount: 1 });
          } catch (e) {
            reject(e);
          }
          resolve();
        }
      },
      error: e => reject(e),
      complete: reject,
    });
  });

  itAsync('should support a simple todo app using local state', (resolve, reject) => {
    const query = gql`
      query GetTasks {
        todos @client {
          message
          title
        }
      }
    `;

    const mutation = gql`
      mutation AddTodo($message: String, $title: String) {
        addTodo(message: $message, title: $title) @client
      }
    `;

    const client = new ApolloClient({
      link: ApolloLink.empty(),
      cache: new InMemoryCache(),
      resolvers: {},
    });

    interface Todo {
      title: string;
      message: string;
      __typename: string;
    }

    const update = (
      query: DocumentNode,
      updater: (todos: any, variables: Todo) => any,
    ) => {
      return (
        _result: {},
        variables: Todo,
        { cache }: { cache: ApolloCache<any> },
      ): null => {
        const data = updater(client.readQuery({ query, variables }), variables);
        cache.writeQuery({ query, variables, data });
        return null;
      };
    };

    const resolvers = {
      Query: {
        todos: () => [],
      },
      Mutation: {
        addTodo: update(query, ({ todos }, { title, message }: Todo) => ({
          todos: todos.concat([{ message, title, __typename: 'Todo' }]),
        })),
      },
    };

    client.addResolvers(resolvers);

    let count = 0;
    client.watchQuery({ query }).subscribe({
      next: ({ data }: any) => {
        count++;
        if (count === 1) {
          expect({ ...data }).toMatchObject({ todos: [] });
          client.mutate({
            mutation,
            variables: {
              title: 'Apollo Client 2.0',
              message: 'ship it',
            },
          });
        } else if (count === 2) {
          expect(data.todos.map((x: Todo) => ({ ...x }))).toMatchObject([
            {
              title: 'Apollo Client 2.0',
              message: 'ship it',
              __typename: 'Todo',
            },
          ]);
          resolve();
        }
      },
    });
  });
});

describe('Combining client and server state/operations', () => {
  itAsync('should merge remote and local state', (resolve, reject) => {
    const query = gql`
      query list {
        list(name: "my list") {
          items {
            id
            name
            isDone
            isSelected @client
          }
        }
      }
    `;

    const data = {
      list: {
        __typename: 'List',
        items: [
          { __typename: 'ListItem', id: 1, name: 'first', isDone: true },
          { __typename: 'ListItem', id: 2, name: 'second', isDone: false },
        ],
      },
    };

    const link = new ApolloLink(() => Observable.of({ data }));

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link,
      resolvers: {
        Mutation: {
          toggleItem: async (_, { id }, { cache }) => {
            id = `ListItem:${id}`;
            const fragment = gql`
              fragment item on ListItem {
                __typename
                isSelected
              }
            `;
            const previous = cache.readFragment({ fragment, id });
            const data = {
              ...previous,
              isSelected: !previous.isSelected,
            };
            await cache.writeFragment({
              id,
              fragment,
              data,
            });

            return data;
          },
        },
        ListItem: {
          isSelected(source) {
            expect(source.name).toBeDefined();
            // List items default to an unselected state
            return false;
          },
        },
      },
    });

    const observer = client.watchQuery({ query });

    let count = 0;
    observer.subscribe({
      next: response => {
        if (count === 0) {
          const initial = { ...data };
          initial.list.items = initial.list.items.map(x => ({
            ...x,
            isSelected: false,
          }));
          expect(response.data).toMatchObject(initial);
        }
        if (count === 1) {
          expect((response.data as any).list.items[0].isSelected).toBe(true);
          expect((response.data as any).list.items[1].isSelected).toBe(false);
          resolve();
        }
        count++;
      },
      error: reject,
    });
    const variables = { id: 1 };
    const mutation = gql`
      mutation SelectItem($id: Int!) {
        toggleItem(id: $id) @client
      }
    `;
    // After initial result, toggle the state of one of the items
    setTimeout(() => {
      client.mutate({ mutation, variables });
    }, 10);
  });

  itAsync('should correctly propagate an error from a client resolver', async (resolve, reject) => {
    const data = {
      list: {
        __typename: 'List',
        items: [
          { __typename: 'ListItem', id: 1, name: 'first', isDone: true },
          { __typename: 'ListItem', id: 2, name: 'second', isDone: false },
        ],
      },
    };

    const link = new ApolloLink(() => Observable.of({ data }));

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link,
      resolvers: {
        Query: {
          hasBeenIllegallyTouched: (_, _v, _c) => {
            throw new Error('Illegal Query Operation Occurred');
          },
        },

        Mutation: {
          touchIllegally: (_, _v, _c) => {
            throw new Error('Illegal Mutation Operation Occurred');
          },
        },
      },
    });

    const variables = { id: 1 };
    const query = gql`
      query hasBeenIllegallyTouched($id: Int!) {
        hasBeenIllegallyTouched(id: $id) @client
      }
    `;
    const mutation = gql`
      mutation SelectItem($id: Int!) {
        touchIllegally(id: $id) @client
      }
    `;

    try {
      await client.query({ query, variables });
      reject('Should have thrown!');
    } catch (e) {
      // Test Passed!
      expect(() => {
        throw e;
      }).toThrowErrorMatchingSnapshot();
    }

    try {
      await client.mutate({ mutation, variables });
      reject('Should have thrown!');
    } catch (e) {
      // Test Passed!
      expect(() => {
        throw e;
      }).toThrowErrorMatchingSnapshot();
    }

    resolve();
  });

  withErrorSpy(itAsync, 'should handle a simple query with both server and client fields', (resolve, reject) => {
    const query = gql`
      query GetCount {
        count @client
        lastCount
      }
    `;
    const cache = new InMemoryCache();

    const link = new ApolloLink(operation => {
      expect(operation.operationName).toBe('GetCount');
      return Observable.of({ data: { lastCount: 1 } });
    });

    const client = new ApolloClient({
      cache,
      link,
      resolvers: {},
    });

    cache.writeQuery({
      query,
      data: {
        count: 0,
      },
    });

    client.watchQuery({ query }).subscribe({
      next: ({ data }) => {
        expect({ ...data }).toMatchObject({ count: 0, lastCount: 1 });
        resolve();
      },
    });
  });

  withErrorSpy(itAsync, 'should support nested querying of both server and client fields', (resolve, reject) => {
    const query = gql`
      query GetUser {
        user {
          firstName @client
          lastName
        }
      }
    `;

    const cache = new InMemoryCache();
    const link = new ApolloLink(operation => {
      expect(operation.operationName).toBe('GetUser');
      return Observable.of({
        data: {
          user: {
            __typename: 'User',
            // We need an id (or a keyFields policy) because, if the User
            // object is not identifiable, the call to cache.writeQuery
            // below will simply replace the existing data rather than
            // merging the new data with the existing data.
            id: 123,
            lastName: 'Doe',
          },
        },
      });
    });

    const client = new ApolloClient({
      cache,
      link,
      resolvers: {},
    });

    cache.writeQuery({
      query,
      data: {
        user: {
          __typename: 'User',
          id: 123,
          firstName: 'John',
        },
      },
    });

    client.watchQuery({ query }).subscribe({
      next({ data }: any) {
        const { user } = data;
        try {
          expect(user).toMatchObject({
            firstName: 'John',
            lastName: 'Doe',
            __typename: 'User',
          });
        } catch (e) {
          reject(e);
        }
        resolve();
      },
    });
  });

  itAsync('should combine both server and client mutations', (resolve, reject) => {
    const query = gql`
      query SampleQuery {
        count @client
        user {
          firstName
        }
      }
    `;

    const mutation = gql`
      mutation SampleMutation {
        incrementCount @client
        updateUser(firstName: "Harry") {
          firstName
        }
      }
    `;

    const counterQuery = gql`
      {
        count @client
      }
    `;

    const userQuery = gql`
      {
        user {
          firstName
        }
      }
    `;

    let watchCount = 0;
    const link = new ApolloLink((operation: Operation): Observable<{}> => {
      if (operation.operationName === 'SampleQuery') {
        return Observable.of({
          data: { user: { __typename: 'User', firstName: 'John' } },
        });
      }
      if (operation.operationName === 'SampleMutation') {
        return Observable.of({
          data: { updateUser: { __typename: 'User', firstName: 'Harry' } },
        });
      }
      return Observable.of({
        errors: [new Error(`Unknown operation ${operation.operationName}`)],
      })
    });

    const cache = new InMemoryCache();
    const client = new ApolloClient({
      cache,
      link,
      resolvers: {
        Mutation: {
          incrementCount: (_, __, { cache }) => {
            const { count } = cache.readQuery({ query: counterQuery });
            const data = { count: count + 1 };
            cache.writeQuery({
              query: counterQuery,
              data,
            });
            return null;
          },
        },
      },
    });

    cache.writeQuery({
      query: counterQuery,
      data: {
        count: 0,
      },
    });

    client.watchQuery({ query }).subscribe({
      next: ({ data }: any) => {
        if (watchCount === 0) {
          expect(data.count).toEqual(0);
          expect({ ...data.user }).toMatchObject({
            __typename: 'User',
            firstName: 'John',
          });
          watchCount += 1;
          client.mutate({
            mutation,
            update(proxy, { data: { updateUser } }: { data: any }) {
              proxy.writeQuery({
                query: userQuery,
                data: {
                  user: { ...updateUser },
                },
              });
            },
          });
        } else {
          expect(data.count).toEqual(1);
          expect({ ...data.user }).toMatchObject({
            __typename: 'User',
            firstName: 'Harry',
          });
          resolve();
        }
      },
    });
  });
});
