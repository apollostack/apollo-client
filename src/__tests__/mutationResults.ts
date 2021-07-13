import { cloneDeep } from 'lodash';
import gql from 'graphql-tag';
import { GraphQLError } from 'graphql';

import { ApolloClient } from '../core';
import { InMemoryCache } from '../cache';
import { ApolloLink } from '../link/core';
import { Observable, ObservableSubscription as Subscription } from '../utilities';
import { itAsync, subscribeAndCount, mockSingleLink, withErrorSpy } from '../testing';

describe('mutation results', () => {
  const query = gql`
    query todoList {
      todoList(id: 5) {
        id
        todos {
          id
          text
          completed
        }
        filteredTodos: todos(completed: true) {
          id
          text
          completed
        }
      }
      noIdList: todoList(id: 6) {
        id
        todos {
          text
          completed
        }
      }
    }
  `;

  const queryWithTypename = gql`
    query todoList {
      todoList(id: 5) {
        id
        todos {
          id
          text
          completed
          __typename
        }
        filteredTodos: todos(completed: true) {
          id
          text
          completed
          __typename
        }
        __typename
      }
      noIdList: todoList(id: 6) {
        id
        todos {
          text
          completed
          __typename
        }
        __typename
      }
    }
  `;

  const result: any = {
    data: {
      __typename: 'Query',
      todoList: {
        __typename: 'TodoList',
        id: '5',
        todos: [
          {
            __typename: 'Todo',
            id: '3',
            text: 'Hello world',
            completed: false,
          },
          {
            __typename: 'Todo',
            id: '6',
            text: 'Second task',
            completed: false,
          },
          {
            __typename: 'Todo',
            id: '12',
            text: 'Do other stuff',
            completed: false,
          },
        ],
        filteredTodos: [],
      },
      noIdList: {
        __typename: 'TodoList',
        id: '7',
        todos: [
          {
            __typename: 'Todo',
            text: 'Hello world',
            completed: false,
          },
          {
            __typename: 'Todo',
            text: 'Second task',
            completed: false,
          },
          {
            __typename: 'Todo',
            text: 'Do other stuff',
            completed: false,
          },
        ],
      },
    },
  };

  function setupObsQuery(
    reject: (reason: any) => any,
    ...mockedResponses: any[]
  ) {
    const client = new ApolloClient({
      link: mockSingleLink({
        request: { query: queryWithTypename } as any,
        result,
      }, ...mockedResponses),
      cache: new InMemoryCache({
        dataIdFromObject: (obj: any) => {
          if (obj.id && obj.__typename) {
            return obj.__typename + obj.id;
          }
          return null;
        },
        // Passing an empty map enables warnings about missing fields:
        possibleTypes: {},
      }),
    });

    return {
      client,
      obsQuery: client.watchQuery({
        query,
        notifyOnNetworkStatusChange: false,
      }),
    };
  }

  function setupDelayObsQuery(
    reject: (reason: any) => any,
    delay: number,
    ...mockedResponses: any[]
  ) {
    const client = new ApolloClient({
      link: mockSingleLink({
        request: { query: queryWithTypename } as any,
        result,
        delay,
      }, ...mockedResponses).setOnError(reject),
      cache: new InMemoryCache({
        dataIdFromObject: (obj: any) => {
          if (obj.id && obj.__typename) {
            return obj.__typename + obj.id;
          }
          return null;
        },
        // Passing an empty map enables warnings about missing fields:
        possibleTypes: {},
      }),
    });

    return {
      client,
      obsQuery: client.watchQuery({
        query,
        notifyOnNetworkStatusChange: false,
      }),
    };
  }

  itAsync('correctly primes cache for tests', (resolve, reject) => {
    const { client, obsQuery } = setupObsQuery(reject);
    return obsQuery.result().then(
      () => client.query({ query })
    ).then(resolve, reject);
  });

  itAsync('correctly integrates field changes by default', (resolve, reject) => {
    const mutation = gql`
      mutation setCompleted {
        setCompleted(todoId: "3") {
          id
          completed
          __typename
        }
        __typename
      }
    `;

    const mutationResult = {
      data: {
        __typename: 'Mutation',
        setCompleted: {
          __typename: 'Todo',
          id: '3',
          completed: true,
        },
      },
    };

    const { client, obsQuery } = setupObsQuery(reject, {
      request: { query: mutation },
      result: mutationResult,
    });

    return obsQuery.result().then(() => {
      return client.mutate({ mutation });
    }).then(() => {
      return client.query({ query });
    }).then((newResult: any) => {
      expect(newResult.data.todoList.todos[0].completed).toBe(true);
    }).then(resolve, reject);
  });

  itAsync('correctly integrates field changes by default with variables', (resolve, reject) => {
    const query = gql`
      query getMini($id: ID!) {
        mini(id: $id) {
          id
          cover(maxWidth: 600, maxHeight: 400)
          __typename
        }
      }
    `;
    const mutation = gql`
      mutation upload($signature: String!) {
        mini: submitMiniCoverS3DirectUpload(signature: $signature) {
          id
          cover(maxWidth: 600, maxHeight: 400)
          __typename
        }
      }
    `;

    const link = mockSingleLink({
      request: {
        query,
        variables: { id: 1 },
      } as any,
      delay: 100,
      result: {
        data: { mini: { id: 1, cover: 'image', __typename: 'Mini' } },
      },
    }, {
      request: {
        query: mutation,
        variables: { signature: '1234' },
      } as any,
      delay: 150,
      result: {
        data: { mini: { id: 1, cover: 'image2', __typename: 'Mini' } },
      },
    }).setOnError(reject);

    interface Data {
      mini: { id: number; cover: string; __typename: string };
    }
    const client = new ApolloClient({
      link,
      cache: new InMemoryCache({
        dataIdFromObject: (obj: any) => {
          if (obj.id && obj.__typename) {
            return obj.__typename + obj.id;
          }
          return null;
        },
      }),
    });

    const obs = client.watchQuery<Data>({
      query,
      variables: { id: 1 },
      notifyOnNetworkStatusChange: false,
    });

    let count = 0;
    obs.subscribe({
      next: result => {
        if (count === 0) {
          client.mutate({ mutation, variables: { signature: '1234' } });
          expect(result.data!.mini.cover).toBe('image');

          setTimeout(() => {
            if (count === 0)
              reject(
                new Error('mutate did not re-call observable with next value'),
              );
          }, 250);
        }
        if (count === 1) {
          expect(result.data!.mini.cover).toBe('image2');
          resolve();
        }
        count++;
      },
      error: reject,
    });
  });

  itAsync("should write results to cache according to errorPolicy", async (resolve, reject) => {
    const expectedFakeError = new GraphQLError("expected/fake error");

    const client = new ApolloClient({
      cache: new InMemoryCache({
        typePolicies: {
          Person: {
            keyFields: ["name"],
          },
        },
      }),

      link: new ApolloLink(operation => new Observable(observer => {
        observer.next({
          errors: [
            expectedFakeError,
          ],
          data: {
            newPerson: {
              __typename: "Person",
              name: operation.variables.newName,
            },
          },
        });
        observer.complete();
      })).setOnError(reject),
    });

    const mutation = gql`
      mutation AddNewPerson($newName: String!) {
        newPerson(name: $newName) {
          name
        }
      }
    `;

    await client.mutate({
      mutation,
      variables: {
        newName: "Hugh Willson",
      },
    }).then(() => {
      reject("should have thrown for default errorPolicy");
    }, error => {
      expect(error.message).toBe(expectedFakeError.message);
    });

    expect(client.cache.extract()).toMatchSnapshot();

    const ignoreErrorsResult = await client.mutate({
      mutation,
      errorPolicy: "ignore",
      variables: {
        newName: "Jenn Creighton",
      },
    });

    expect(ignoreErrorsResult).toEqual({
      data: {
        newPerson: {
          __typename: "Person",
          name: "Jenn Creighton",
        },
      },
    });

    expect(client.cache.extract()).toMatchSnapshot();

    const allErrorsResult = await client.mutate({
      mutation,
      errorPolicy: "all",
      variables: {
        newName: "Ellen Shapiro",
      },
    });

    expect(allErrorsResult).toEqual({
      data: {
        newPerson: {
          __typename: "Person",
          name: "Ellen Shapiro",
        },
      },
      errors: [
        expectedFakeError,
      ],
    });

    expect(client.cache.extract()).toMatchSnapshot();

    resolve();
  });

  withErrorSpy(itAsync, "should warn when the result fields don't match the query fields", (resolve, reject) => {
    let handle: any;
    let subscriptionHandle: Subscription;

    const queryTodos = gql`
      query todos {
        todos {
          id
          name
          description
          __typename
        }
      }
    `;

    const queryTodosResult = {
      data: {
        todos: [
          {
            id: '1',
            name: 'Todo 1',
            description: 'Description 1',
            __typename: 'todos',
          },
        ],
      },
    };

    const mutationTodo = gql`
      mutation createTodo {
        createTodo {
          id
          name
          # missing field: description
          __typename
        }
      }
    `;

    const mutationTodoResult = {
      data: {
        createTodo: {
          id: '2',
          name: 'Todo 2',
          __typename: 'createTodo',
        },
      },
    };

    const { client, obsQuery } = setupObsQuery(
      reject,
      {
        request: { query: queryTodos },
        result: queryTodosResult,
      },
      {
        request: { query: mutationTodo },
        result: mutationTodoResult,
      },
    );

    return obsQuery.result().then(() => {
      // we have to actually subscribe to the query to be able to update it
      return new Promise(resolve => {
        handle = client.watchQuery({ query: queryTodos });
        subscriptionHandle = handle.subscribe({
          next(res: any) {
            resolve(res);
          },
        });
      });
    }).then(() => client.mutate({
      mutation: mutationTodo,
      updateQueries: {
        todos: (prev, { mutationResult }) => {
          const newTodo = (mutationResult as any).data.createTodo;
          const newResults = {
            todos: [...(prev as any).todos, newTodo],
          };
          return newResults;
        },
      },
    })).finally(
      () => subscriptionHandle.unsubscribe(),
    ).then(result => {
      expect(result).toEqual(mutationTodoResult);
    }).then(resolve, reject);
  });

  describe('InMemoryCache type/field policies', () => {
    const startTime = Date.now();
    const link = new ApolloLink(operation => new Observable(observer => {
      observer.next({
        data: {
          __typename: "Mutation",
          doSomething: {
            __typename: "MutationPayload",
            time: startTime,
          },
        },
      });
      observer.complete();
    }));

    const mutation = gql`
      mutation DoSomething {
        doSomething {
          time
        }
      }
    `;

    it('mutation update function receives result from cache', () => {
      let timeReadCount = 0;
      let timeMergeCount = 0;

      const client = new ApolloClient({
        link,
        cache: new InMemoryCache({
          typePolicies: {
            MutationPayload: {
              fields: {
                time: {
                  read(ms: number = Date.now()) {
                    ++timeReadCount;
                    return new Date(ms);
                  },
                  merge(existing, incoming: number) {
                    ++timeMergeCount;
                    expect(existing).toBeUndefined();
                    return incoming;
                  },
                },
              },
            },
          },
        }),
      });

      return client.mutate({
        mutation,
        update(cache, {
          data: {
            doSomething: {
              __typename,
              time,
            },
          },
        }) {
          expect(__typename).toBe("MutationPayload");
          expect(time).toBeInstanceOf(Date);
          expect(time.getTime()).toBe(startTime);
          expect(timeReadCount).toBe(1);
          expect(timeMergeCount).toBe(1);
          expect(cache.extract()).toEqual({
            ROOT_MUTATION: {
              __typename: "Mutation",
              doSomething: {
                __typename: "MutationPayload",
                time: startTime,
              },
            },
          });
        },
      }).then(({
        data: {
          doSomething: {
            __typename,
            time,
          },
        },
      }) => {
        expect(__typename).toBe("MutationPayload");
        expect(time).toBeInstanceOf(Date);
        expect(time.getTime()).toBe(startTime);
        expect(timeReadCount).toBe(1);
        expect(timeMergeCount).toBe(1);

        // The contents of the ROOT_MUTATION object exist only briefly, for the
        // duration of the mutation update, and are removed after the mutation
        // write is finished.
        expect(client.cache.extract()).toEqual({
          ROOT_MUTATION: {
            __typename: "Mutation",
          },
        });
      });
    });

    it('mutations can preserve ROOT_MUTATION cache data with keepRootFields: true', () => {
      let timeReadCount = 0;
      let timeMergeCount = 0;

      const client = new ApolloClient({
        link,
        cache: new InMemoryCache({
          typePolicies: {
            MutationPayload: {
              fields: {
                time: {
                  read(ms: number = Date.now()) {
                    ++timeReadCount;
                    return new Date(ms);
                  },
                  merge(existing, incoming: number) {
                    ++timeMergeCount;
                    expect(existing).toBeUndefined();
                    return incoming;
                  },
                },
              },
            },
          },
        }),
      });

      return client.mutate({
        mutation,
        keepRootFields: true,
        update(cache, {
          data: {
            doSomething: {
              __typename,
              time,
            },
          },
        }) {
          expect(__typename).toBe("MutationPayload");
          expect(time).toBeInstanceOf(Date);
          expect(time.getTime()).toBe(startTime);
          expect(timeReadCount).toBe(1);
          expect(timeMergeCount).toBe(1);
          expect(cache.extract()).toEqual({
            ROOT_MUTATION: {
              __typename: "Mutation",
              doSomething: {
                __typename: "MutationPayload",
                time: startTime,
              },
            },
          });
        },
      }).then(({
        data: {
          doSomething: {
            __typename,
            time,
          },
        },
      }) => {
        expect(__typename).toBe("MutationPayload");
        expect(time).toBeInstanceOf(Date);
        expect(time.getTime()).toBe(startTime);
        expect(timeReadCount).toBe(1);
        expect(timeMergeCount).toBe(1);

        expect(client.cache.extract()).toEqual({
          ROOT_MUTATION: {
            __typename: "Mutation",
            doSomething: {
              __typename: "MutationPayload",
              time: startTime,
            },
          },
        });
      });
    });

    it('mutation update function runs even when fetchPolicy is "no-cache"', async () => {
      let timeReadCount = 0;
      let timeMergeCount = 0;
      let mutationUpdateCount = 0;

      const client = new ApolloClient({
        link,
        cache: new InMemoryCache({
          typePolicies: {
            MutationPayload: {
              fields: {
                time: {
                  read(ms: number = Date.now()) {
                    ++timeReadCount;
                    return new Date(ms);
                  },
                  merge(existing, incoming: number) {
                    ++timeMergeCount;
                    expect(existing).toBeUndefined();
                    return incoming;
                  },
                },
              },
            },
          },
        }),
      });

      return client.mutate({
        mutation,
        fetchPolicy: "no-cache",
        update(cache, {
          data: {
            doSomething: {
              __typename,
              time,
            },
          },
        }) {
          expect(++mutationUpdateCount).toBe(1);
          expect(__typename).toBe("MutationPayload");
          expect(time).not.toBeInstanceOf(Date);
          expect(time).toBe(startTime);
          expect(timeReadCount).toBe(0);
          expect(timeMergeCount).toBe(0);
          expect(cache.extract()).toEqual({});
        },
      }).then(({
        data: {
          doSomething: {
            __typename,
            time,
          },
        },
      }) => {
        expect(__typename).toBe("MutationPayload");
        expect(time).not.toBeInstanceOf(Date);
        expect(time).toBe(+startTime);
        expect(timeReadCount).toBe(0);
        expect(timeMergeCount).toBe(0);
        expect(mutationUpdateCount).toBe(1);
        expect(client.cache.extract()).toEqual({});
      });
    });
  });

  describe('updateQueries', () => {
    const mutation = gql`
      mutation createTodo {
        # skipping arguments in the test since they don't matter
        createTodo {
          id
          text
          completed
          __typename
        }
        __typename
      }
    `;

    const mutationResult = {
      data: {
        __typename: 'Mutation',
        createTodo: {
          id: '99',
          __typename: 'Todo',
          text: 'This one was created with a mutation.',
          completed: true,
        },
      },
    };

    itAsync('analogous of ARRAY_INSERT', (resolve, reject) => {
      let subscriptionHandle: Subscription;
      const { client, obsQuery } = setupObsQuery(reject, {
        request: { query: mutation },
        result: mutationResult,
      });

      return obsQuery.result().then(() => {
        // we have to actually subscribe to the query to be able to update it
        return new Promise(resolve => {
          const handle = client.watchQuery({ query });
          subscriptionHandle = handle.subscribe({
            next(res) {
              resolve(res);
            },
          });
        });
      }).then(() => client.mutate({
        mutation,
        updateQueries: {
          todoList: (prev, options) => {
            const mResult = options.mutationResult as any;
            expect(mResult.data.createTodo.id).toBe('99');
            expect(mResult.data.createTodo.text).toBe(
              'This one was created with a mutation.',
            );
            const state = cloneDeep(prev) as any;
            state.todoList.todos.unshift(mResult.data.createTodo);
            return state;
          },
        },
      })).then(
        () => client.query({ query })
      ).then((newResult: any) => {
        subscriptionHandle.unsubscribe();

        // There should be one more todo item than before
        expect(newResult.data.todoList.todos.length).toBe(4);

        // Since we used `prepend` it should be at the front
        expect(newResult.data.todoList.todos[0].text).toBe(
          'This one was created with a mutation.',
        );
      }).then(resolve, reject);
    });

    itAsync('does not fail if optional query variables are not supplied', (resolve, reject) => {
      let subscriptionHandle: Subscription;
      const mutationWithVars = gql`
        mutation createTodo($requiredVar: String!, $optionalVar: String) {
          createTodo(requiredVar: $requiredVar, optionalVar: $optionalVar) {
            id
            text
            completed
            __typename
          }
          __typename
        }
      `;

      // the test will pass if optionalVar is uncommented
      const variables = {
        requiredVar: 'x',
        // optionalVar: 'y',
      };
      const { client, obsQuery } = setupObsQuery(reject, {
        request: {
          query: mutationWithVars,
          variables,
        },
        result: mutationResult,
      });

      return obsQuery.result().then(() => {
        // we have to actually subscribe to the query to be able to update it
        return new Promise(resolve => {
          const handle = client.watchQuery({
            query,
            variables,
          });
          subscriptionHandle = handle.subscribe({
            next(res) {
              resolve(res);
            },
          });
        });
      }).then(() => client.mutate({
        mutation: mutationWithVars,
        variables,
        updateQueries: {
          todoList: (prev, options) => {
            const mResult = options.mutationResult as any;
            expect(mResult.data.createTodo.id).toBe('99');
            expect(mResult.data.createTodo.text).toBe(
              'This one was created with a mutation.',
            );
            const state = cloneDeep(prev) as any;
            state.todoList.todos.unshift(mResult.data.createTodo);
            return state;
          },
        },
      })).then(() => {
        return client.query({ query });
      }).then((newResult: any) => {
        subscriptionHandle.unsubscribe();

        // There should be one more todo item than before
        expect(newResult.data.todoList.todos.length).toBe(4);

        // Since we used `prepend` it should be at the front
        expect(newResult.data.todoList.todos[0].text).toBe(
          'This one was created with a mutation.',
        );
      }).then(resolve, reject);
    });

    itAsync('does not fail if the query did not complete correctly', (resolve, reject) => {
      const { client, obsQuery } = setupObsQuery(reject, {
        request: { query: mutation },
        result: mutationResult,
      });
      const subs = obsQuery.subscribe({
        next: () => null,
      });
      // Cancel the query right away!
      subs.unsubscribe();
      return client.mutate({
        mutation,
        updateQueries: {
          todoList: (prev, options) => {
            const mResult = options.mutationResult as any;
            expect(mResult.data.createTodo.id).toBe('99');
            expect(mResult.data.createTodo.text).toBe(
              'This one was created with a mutation.',
            );

            const state = cloneDeep(prev) as any;
            state.todoList.todos.unshift(mResult.data.createTodo);
            return state;
          },
        },
      }).then(resolve, reject);
    });

    itAsync('does not fail if the query did not finish loading', (resolve, reject) => {
      const { client, obsQuery } = setupDelayObsQuery(reject, 15, {
        request: { query: mutation },
        result: mutationResult,
      });
      obsQuery.subscribe({
        next: () => null,
      });
      return client.mutate({
        mutation,
        updateQueries: {
          todoList: (prev, options) => {
            const mResult = options.mutationResult as any;
            expect(mResult.data.createTodo.id).toBe('99');
            expect(mResult.data.createTodo.text).toBe(
              'This one was created with a mutation.',
            );

            const state = cloneDeep(prev) as any;
            state.todoList.todos.unshift(mResult.data.createTodo);
            return state;
          },
        },
      }).then(resolve, reject);
    });

    itAsync('does not make next queries fail if a mutation fails', (resolve, reject) => {
      const { client, obsQuery } = setupObsQuery(
        error => { throw error },
        {
          request: { query: mutation },
          result: { errors: [new Error('mock error')] },
        },
        {
          request: { query: queryWithTypename },
          result,
        },
      );

      obsQuery.subscribe({
        next() {
          client
            .mutate({
              mutation,
              updateQueries: {
                todoList: (prev, options) => {
                  const mResult = options.mutationResult as any;
                  const state = cloneDeep(prev) as any;
                  // It's unfortunate that this function is called at all, but we are removing
                  // the updateQueries API soon so it won't matter.
                  state.todoList.todos.unshift(
                    mResult.data && mResult.data.createTodo,
                  );
                  return state;
                },
              },
            })
            .then(
              () => reject(new Error('Mutation should have failed')),
              () =>
                client.mutate({
                  mutation,
                  updateQueries: {
                    todoList: (prev, options) => {
                      const mResult = options.mutationResult as any;
                      const state = cloneDeep(prev) as any;
                      state.todoList.todos.unshift(mResult.data.createTodo);
                      return state;
                    },
                  },
                }),
            )
            .then(
              () => reject(new Error('Mutation should have failed')),
              () => obsQuery.refetch(),
            )
            .then(resolve, reject);
        },
      });
    });

    itAsync('error handling in reducer functions', (resolve, reject) => {
      let subscriptionHandle: Subscription;
      const { client, obsQuery } = setupObsQuery(reject, {
        request: { query: mutation },
        result: mutationResult,
      });

      return obsQuery.result().then(() => {
        // we have to actually subscribe to the query to be able to update it
        return new Promise(resolve => {
          const handle = client.watchQuery({ query });
          subscriptionHandle = handle.subscribe({
            next(res) {
              resolve(res);
            },
          });
        });
      }).then(() => client.mutate({
        mutation,
        updateQueries: {
          todoList: () => {
            throw new Error(`Hello... It's me.`);
          },
        },
      })).then(() => {
        subscriptionHandle.unsubscribe();
        reject("should have thrown");
      }, error => {
        subscriptionHandle.unsubscribe();
        expect(error.message).toBe(`Hello... It's me.`);
      }).then(resolve, reject);
    });
  });

  itAsync('does not fail if one of the previous queries did not complete correctly', (resolve, reject) => {
    const variableQuery = gql`
      query Echo($message: String) {
        echo(message: $message)
      }
    `;

    const variables1 = {
      message: 'a',
    };

    const result1 = {
      data: {
        echo: 'a',
      },
    };

    const variables2 = {
      message: 'b',
    };

    const result2 = {
      data: {
        echo: 'b',
      },
    };

    const resetMutation = gql`
      mutation Reset {
        reset {
          echo
        }
      }
    `;

    const resetMutationResult = {
      data: {
        reset: {
          echo: '0',
        },
      },
    };

    const client = new ApolloClient({
      link: mockSingleLink({
        request: { query: variableQuery, variables: variables1 } as any,
        result: result1,
      }, {
        request: { query: variableQuery, variables: variables2 } as any,
        result: result2,
      }, {
        request: { query: resetMutation } as any,
        result: resetMutationResult,
      }).setOnError(reject),
      cache: new InMemoryCache({ addTypename: false }),
    });

    const watchedQuery = client.watchQuery({
      query: variableQuery,
      variables: variables1,
    });

    const firstSubs = watchedQuery.subscribe({
      next: () => null,
      error: reject,
    });

    // Cancel the query right away!
    firstSubs.unsubscribe();

    subscribeAndCount(reject, watchedQuery, (count, result) => {
      if (count === 1) {
        expect(result.data).toEqual({ echo: "a" });
      } else if (count === 2) {
        expect(result.data).toEqual({ echo: "b" });
        client.mutate({
          mutation: resetMutation,
          updateQueries: {
            Echo: () => {
              return { echo: "0" };
            },
          },
        });
      } else if (count === 3) {
        expect(result.data).toEqual({ echo: "0" });
        resolve();
      }
    });

    watchedQuery.refetch(variables2);
  });

  itAsync('allows mutations with optional arguments', (resolve, reject) => {
    let count = 0;

    const client = new ApolloClient({
      cache: new InMemoryCache({ addTypename: false }),
      link: ApolloLink.from([
        ({ variables }: any) =>
          new Observable(observer => {
            switch (count++) {
              case 0:
                expect(variables).toEqual({ a: 1, b: 2 });
                observer.next({ data: { result: 'hello' } });
                observer.complete();
                return;
              case 1:
                expect(variables).toEqual({ a: 1, c: 3 });
                observer.next({ data: { result: 'world' } });
                observer.complete();
                return;
              case 2:
                expect(variables).toEqual({
                  a: undefined,
                  b: 2,
                  c: 3,
                });
                observer.next({ data: { result: 'goodbye' } });
                observer.complete();
                return;
              case 3:
                expect(variables).toEqual({});
                observer.next({ data: { result: 'moon' } });
                observer.complete();
                return;
              default:
                observer.error(new Error('Too many network calls.'));
                return;
            }
          }),
      ] as any),
    });

    const mutation = gql`
      mutation($a: Int!, $b: Int, $c: Int) {
        result(a: $a, b: $b, c: $c)
      }
    `;

    Promise.all([
      client.mutate({
        mutation,
        variables: { a: 1, b: 2 },
      }),
      client.mutate({
        mutation,
        variables: { a: 1, c: 3 },
      }),
      client.mutate({
        mutation,
        variables: { a: undefined, b: 2, c: 3 },
      }),
      client.mutate({
        mutation,
      }),
    ]).then(results => {
      expect(client.cache.extract()).toEqual({
        ROOT_MUTATION: {
          __typename: "Mutation",
        },
      });
      expect(results).toEqual([
        { data: { result: "hello" }},
        { data: { result: "world" }},
        { data: { result: "goodbye" }},
        { data: { result: "moon" }},
      ]);
    }).then(resolve, reject);
  });

  itAsync('allows mutations with default values', (resolve, reject) => {
    let count = 0;

    const client = new ApolloClient({
      cache: new InMemoryCache({ addTypename: false }),
      link: ApolloLink.from([
        ({ variables }: any) =>
          new Observable(observer => {
            switch (count++) {
              case 0:
                expect(variables).toEqual({
                  a: 1,
                  b: 'water',
                });
                observer.next({ data: { result: 'hello' } });
                observer.complete();
                return;
              case 1:
                expect(variables).toEqual({
                  a: 2,
                  b: 'cheese',
                  c: 3,
                });
                observer.next({ data: { result: 'world' } });
                observer.complete();
                return;
              case 2:
                expect(variables).toEqual({
                  a: 1,
                  b: 'cheese',
                  c: 3,
                });
                observer.next({ data: { result: 'goodbye' } });
                observer.complete();
                return;
              default:
                observer.error(new Error('Too many network calls.'));
                return;
            }
          }),
      ] as any),
    });

    const mutation = gql`
      mutation($a: Int = 1, $b: String = "cheese", $c: Int) {
        result(a: $a, b: $b, c: $c)
      }
    `;

    Promise.all([
      client.mutate({
        mutation,
        variables: { a: 1, b: 'water' },
      }),
      client.mutate({
        mutation,
        variables: { a: 2, c: 3 },
      }),
      client.mutate({
        mutation,
        variables: { c: 3 },
      }),
    ]).then(results => {
      expect(client.cache.extract()).toEqual({
        ROOT_MUTATION: {
          __typename: "Mutation",
        },
      });
      expect(results).toEqual([
        { data: { result: 'hello' }},
        { data: { result: 'world' }},
        { data: { result: 'goodbye' }},
      ]);
    }).then(resolve, reject);
  });

  itAsync('will pass null to the network interface when provided', (resolve, reject) => {
    let count = 0;

    const client = new ApolloClient({
      cache: new InMemoryCache({ addTypename: false }),
      link: ApolloLink.from([
        ({ variables }: any) =>
          new Observable(observer => {
            switch (count++) {
              case 0:
                expect(variables).toEqual({
                  a: 1,
                  b: 2,
                  c: null,
                });
                observer.next({ data: { result: 'hello' } });
                observer.complete();
                return;
              case 1:
                expect(variables).toEqual({
                  a: 1,
                  b: null,
                  c: 3,
                });
                observer.next({ data: { result: 'world' } });
                observer.complete();
                return;
              case 2:
                expect(variables).toEqual({
                  a: null,
                  b: null,
                  c: null,
                });
                observer.next({ data: { result: 'moon' } });
                observer.complete();
                return;
              default:
                observer.error(new Error('Too many network calls.'));
                return;
            }
          }),
      ] as any),
    });

    const mutation = gql`
      mutation($a: Int!, $b: Int, $c: Int) {
        result(a: $a, b: $b, c: $c)
      }
    `;

    Promise.all([
      client.mutate({
        mutation,
        variables: { a: 1, b: 2, c: null },
      }),
      client.mutate({
        mutation,
        variables: { a: 1, b: null, c: 3 },
      }),
      client.mutate({
        mutation,
        variables: { a: null, b: null, c: null },
      }),
    ]).then(results => {
      expect(client.cache.extract()).toEqual({
        ROOT_MUTATION: {
          __typename: "Mutation",
        },
      });
      expect(results).toEqual([
        { data: { result: 'hello' }},
        { data: { result: 'world' }},
        { data: { result: 'moon' }},
      ]);
    }).then(resolve, reject);
  });

  describe('store transaction updater', () => {
    const mutation = gql`
      mutation createTodo {
        # skipping arguments in the test since they don't matter
        createTodo {
          id
          text
          completed
          __typename
        }
        __typename
      }
    `;

    const mutationResult = {
      data: {
        __typename: 'Mutation',
        createTodo: {
          id: '99',
          __typename: 'Todo',
          text: 'This one was created with a mutation.',
          completed: true,
        },
      },
    };

    itAsync('analogous of ARRAY_INSERT', (resolve, reject) => {
      let subscriptionHandle: Subscription;
      const { client, obsQuery } = setupObsQuery(reject, {
        request: { query: mutation },
        result: mutationResult,
      });

      return obsQuery.result().then(() => {
        // we have to actually subscribe to the query to be able to update it
        return new Promise(resolve => {
          const handle = client.watchQuery({ query });
          subscriptionHandle = handle.subscribe({
            next(res) {
              resolve(res);
            },
          });
        });
      }).then(() => client.mutate({
        mutation,
        update: (proxy, mResult: any) => {
          expect(mResult.data.createTodo.id).toBe('99');
          expect(mResult.data.createTodo.text).toBe(
            'This one was created with a mutation.',
          );

          const id = 'TodoList5';
          const fragment = gql`
            fragment todoList on TodoList {
              todos {
                id
                text
                completed
                __typename
              }
            }
          `;

          const data: any = proxy.readFragment({ id, fragment });

          proxy.writeFragment({
            data: {
              ...data,
              todos: [mResult.data.createTodo, ...data.todos],
            },
            id,
            fragment,
          });
        },
      })).then(() => {
        return client.query({ query });
      }).then((newResult: any) => {
        subscriptionHandle.unsubscribe();

        // There should be one more todo item than before
        expect(newResult.data.todoList.todos.length).toBe(4);

        // Since we used `prepend` it should be at the front
        expect(newResult.data.todoList.todos[0].text).toBe(
          'This one was created with a mutation.',
        );
      }).then(resolve, reject);
    });

    itAsync('does not fail if optional query variables are not supplied', (resolve, reject) => {
      let subscriptionHandle: Subscription;
      const mutationWithVars = gql`
        mutation createTodo($requiredVar: String!, $optionalVar: String) {
          createTodo(requiredVar: $requiredVar, optionalVar: $optionalVar) {
            id
            text
            completed
            __typename
          }
          __typename
        }
      `;

      // the test will pass if optionalVar is uncommented
      const variables = {
        requiredVar: 'x',
        // optionalVar: 'y',
      };

      const { client, obsQuery } = setupObsQuery(reject, {
        request: {
          query: mutationWithVars,
          variables,
        },
        result: mutationResult,
      });

      return obsQuery.result().then(() => {
        // we have to actually subscribe to the query to be able to update it
        return new Promise(resolve => {
          const handle = client.watchQuery({
            query,
            variables,
          });
          subscriptionHandle = handle.subscribe({
            next(res) {
              resolve(res);
            },
          });
        });
      }).then(() => client.mutate({
        mutation: mutationWithVars,
        variables,
        update: (proxy, mResult: any) => {
          expect(mResult.data.createTodo.id).toBe('99');
          expect(mResult.data.createTodo.text).toBe(
            'This one was created with a mutation.',
          );

          const id = 'TodoList5';
          const fragment = gql`
            fragment todoList on TodoList {
              todos {
                id
                text
                completed
                __typename
              }
            }
          `;

          const data: any = proxy.readFragment({ id, fragment });

          proxy.writeFragment({
            data: {
              ...data,
              todos: [mResult.data.createTodo, ...data.todos],
            },
            id,
            fragment,
          });
        },
      })).then(() => {
        return client.query({ query });
      }).then((newResult: any) => {
        subscriptionHandle.unsubscribe();

        // There should be one more todo item than before
        expect(newResult.data.todoList.todos.length).toBe(4);

        // Since we used `prepend` it should be at the front
        expect(newResult.data.todoList.todos[0].text).toBe(
          'This one was created with a mutation.',
        );
      }).then(resolve, reject);
    });

    itAsync('does not make next queries fail if a mutation fails', (resolve, reject) => {
      const { client, obsQuery } = setupObsQuery(
        error => { throw error },
        {
          request: { query: mutation },
          result: { errors: [new Error('mock error')] },
        },
        {
          request: { query: queryWithTypename },
          result,
        },
      );

      obsQuery.subscribe({
        next() {
          client
            .mutate({
              mutation,
              update: (proxy, mResult: any) => {
                expect(mResult.data.createTodo.id).toBe('99');
                expect(mResult.data.createTodo.text).toBe(
                  'This one was created with a mutation.',
                );

                const id = 'TodoList5';
                const fragment = gql`
                  fragment todoList on TodoList {
                    todos {
                      id
                      text
                      completed
                      __typename
                    }
                  }
                `;

                const data: any = proxy.readFragment({ id, fragment });

                proxy.writeFragment({
                  data: {
                    ...data,
                    todos: [mResult.data.createTodo, ...data.todos],
                  },
                  id,
                  fragment,
                });
              },
            })
            .then(
              () => reject(new Error('Mutation should have failed')),
              () =>
                client.mutate({
                  mutation,
                  update: (proxy, mResult: any) => {
                    expect(mResult.data.createTodo.id).toBe('99');
                    expect(mResult.data.createTodo.text).toBe(
                      'This one was created with a mutation.',
                    );

                    const id = 'TodoList5';
                    const fragment = gql`
                      fragment todoList on TodoList {
                        todos {
                          id
                          text
                          completed
                          __typename
                        }
                      }
                    `;

                    const data: any = proxy.readFragment({ id, fragment });

                    proxy.writeFragment({
                      data: {
                        ...data,
                        todos: [mResult.data.createTodo, ...data.todos],
                      },
                      id,
                      fragment,
                    });
                  },
                }),
            )
            .then(
              () => reject(new Error('Mutation should have failed')),
              () => obsQuery.refetch(),
            )
            .then(resolve, reject);
        },
      });
    });

    itAsync('error handling in reducer functions', (resolve, reject) => {
      let subscriptionHandle: Subscription;
      const { client, obsQuery } = setupObsQuery(reject, {
        request: { query: mutation },
        result: mutationResult,
      });

      return obsQuery.result().then(() => {
        // we have to actually subscribe to the query to be able to update it
        return new Promise(resolve => {
          const handle = client.watchQuery({ query });
          subscriptionHandle = handle.subscribe({
            next(res) {
              resolve(res);
            },
          });
        });
      }).then(() => client.mutate({
        mutation,
        update: () => {
          throw new Error(`Hello... It's me.`);
        },
      })).then(() => {
        subscriptionHandle.unsubscribe();
        reject("should have thrown");
      }, error => {
        subscriptionHandle.unsubscribe();
        expect(error.message).toBe(`Hello... It's me.`);
      }).then(resolve, reject);
    });

    itAsync('mutate<MyType>() data should never be `undefined` in case of success', (resolve, reject) => {

      const mutation = gql`
        mutation Foo {
          foo {
            bar
          }
        }
      `;

      const result1 = {
        data: {
          foo: {
            bar: 'a',
          },
        },
      };

      const client = new ApolloClient({
        link: mockSingleLink({
          request: {query: mutation} as any,
          result: result1,

        }).setOnError(reject),
        cache: new InMemoryCache({addTypename: false}),
      });

      client.mutate<{ foo: { bar: string; }; }>({
        mutation: mutation,
      }).then(result => {
        // This next line should **not** raise "TS2533: Object is possibly 'null' or 'undefined'.", even without `!` operator
        if (result.data!.foo.bar) {
          resolve();
        }
      }, reject);
    })
  });
});
