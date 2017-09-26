import { assign, cloneDeep } from 'lodash';
import { addTypenameToDocument } from 'apollo-utilities';
import InMemoryCache from 'apollo-cache-inmemory';

import { mockSingleLink } from '../__mocks__/mockLinks';

import { MutationQueryReducersMap } from '../core/types';
import { Subscription } from '../util/Observable';

import ApolloClient from '../';

import gql from 'graphql-tag';

describe('optimistic mutation results', () => {
  const query = gql`
    query todoList {
      __typename
      todoList(id: 5) {
        __typename
        id
        todos {
          id
          __typename
          text
          completed
        }
        filteredTodos: todos(completed: true) {
          id
          __typename
          text
          completed
        }
      }
      noIdList: todoList(id: 6) {
        __typename
        id
        todos {
          __typename
          text
          completed
        }
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

  let client: ApolloClient;
  let link: any;

  function setup(...mockedResponses: any[]) {
    link = mockSingleLink(
      {
        request: { query },
        result,
      },
      ...mockedResponses,
    );

    client = new ApolloClient({
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

    const obsHandle = client.watchQuery({
      query,
    });

    return obsHandle.result();
  }

  describe('error handling', () => {
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
          __typename: 'Todo',
          id: '99',
          text: 'This one was created with a mutation.',
          completed: true,
        },
      },
    };

    const mutationResult2 = {
      data: assign({}, mutationResult.data, {
        createTodo: assign({}, mutationResult.data.createTodo, {
          id: '66',
          text: 'Second mutation.',
        }),
      }),
    };

    const optimisticResponse = {
      __typename: 'Mutation',
      createTodo: {
        __typename: 'Todo',
        id: '99',
        text: 'Optimistically generated',
        completed: true,
      },
    };

    const optimisticResponse2 = assign({}, optimisticResponse, {
      createTodo: assign({}, optimisticResponse.createTodo, {
        id: '66',
        text: 'Optimistically generated 2',
      }),
    });

    describe('with `updateQueries`', () => {
      const updateQueries = {
        todoList: (prev: any, options: any) => {
          const state = cloneDeep(prev);
          state.todoList.todos.unshift(options.mutationResult.data.createTodo);
          return state;
        },
      };

      it('handles a single error for a single mutation', () => {
        return setup({
          request: { query: mutation },
          error: new Error('forbidden (test error)'),
        })
          .then(() => {
            const promise = client.mutate({
              mutation,
              optimisticResponse,
              updateQueries,
            });

            const dataInStore = (client.queryManager.dataStore.getCache() as InMemoryCache).extract(
              true,
            );
            expect((dataInStore['TodoList5'] as any).todos.length).toBe(4);
            expect((dataInStore['Todo99'] as any).text).toBe(
              'Optimistically generated',
            );

            return promise;
          })
          .catch(err => {
            expect(err).toBeInstanceOf(Error);
            expect(err.message).toBe('Network error: forbidden (test error)');

            const dataInStore = (client.queryManager.dataStore.getCache() as InMemoryCache).extract(
              true,
            );
            expect((dataInStore['TodoList5'] as any).todos.length).toBe(3);
            expect(dataInStore).not.toHaveProperty('Todo99');
          });
      });

      it('handles errors produced by one mutation in a series', () => {
        let subscriptionHandle: Subscription;
        return setup(
          {
            request: { query: mutation },
            error: new Error('forbidden (test error)'),
          },
          {
            request: { query: mutation },
            result: mutationResult2,
          },
        )
          .then(() => {
            // we have to actually subscribe to the query to be able to update it
            return new Promise(resolve => {
              const handle = client.watchQuery({ query });
              subscriptionHandle = handle.subscribe({
                next(res) {
                  resolve(res);
                },
              });
            });
          })
          .then(() => {
            const promise = client
              .mutate({
                mutation,
                optimisticResponse,
                updateQueries,
              })
              .catch(err => {
                // it is ok to fail here
                expect(err).toBeInstanceOf(Error);
                expect(err.message).toBe(
                  'Network error: forbidden (test error)',
                );
                return null;
              });

            const promise2 = client.mutate({
              mutation,
              optimisticResponse: optimisticResponse2,
              updateQueries,
            });

            const dataInStore = (client.queryManager.dataStore.getCache() as InMemoryCache).extract(
              true,
            );
            expect((dataInStore['TodoList5'] as any).todos.length).toBe(5);
            expect((dataInStore['Todo99'] as any).text).toBe(
              'Optimistically generated',
            );
            expect((dataInStore['Todo66'] as any).text).toBe(
              'Optimistically generated 2',
            );

            return Promise.all([promise, promise2]);
          })
          .then(() => {
            subscriptionHandle.unsubscribe();
            const dataInStore = (client.queryManager.dataStore.getCache() as InMemoryCache).extract(
              true,
            );
            expect((dataInStore['TodoList5'] as any).todos.length).toBe(4);
            expect(dataInStore).not.toHaveProperty('Todo99');
            expect(dataInStore).toHaveProperty('Todo66');
            expect((dataInStore['TodoList5'] as any).todos).toContainEqual(
              realIdValue('Todo66'),
            );
            expect((dataInStore['TodoList5'] as any).todos).not.toContainEqual(
              realIdValue('Todo99'),
            );
          });
      });

      it('can run 2 mutations concurrently and handles all intermediate states well', () => {
        function checkBothMutationsAreApplied(
          expectedText1: any,
          expectedText2: any,
        ) {
          const dataInStore = (client.queryManager.dataStore.getCache() as InMemoryCache).extract(
            true,
          );
          expect((dataInStore['TodoList5'] as any).todos.length).toBe(5);
          expect(dataInStore).toHaveProperty('Todo99');
          expect(dataInStore).toHaveProperty('Todo66');
          // <any> can be removed once @types/chai adds deepInclude
          expect((dataInStore['TodoList5'] as any).todos).toContainEqual(
            realIdValue('Todo66'),
          );
          expect((dataInStore['TodoList5'] as any).todos).toContainEqual(
            realIdValue('Todo99'),
          );
          expect((dataInStore['Todo99'] as any).text).toBe(expectedText1);
          expect((dataInStore['Todo66'] as any).text).toBe(expectedText2);
        }
        let subscriptionHandle: Subscription;
        return setup(
          {
            request: { query: mutation },
            result: mutationResult,
          },
          {
            request: { query: mutation },
            result: mutationResult2,
            // make sure it always happens later
            delay: 100,
          },
        )
          .then(() => {
            // we have to actually subscribe to the query to be able to update it
            return new Promise(resolve => {
              const handle = client.watchQuery({ query });
              subscriptionHandle = handle.subscribe({
                next(res) {
                  resolve(res);
                },
              });
            });
          })
          .then(() => {
            const promise = client
              .mutate({
                mutation,
                optimisticResponse,
                updateQueries,
              })
              .then(res => {
                checkBothMutationsAreApplied(
                  'This one was created with a mutation.',
                  'Optimistically generated 2',
                );
                const latestState = client.queryManager.mutationStore;
                expect(latestState.get('5').loading).toBe(false);
                expect(latestState.get('6').loading).toBe(true);

                return res;
              });

            const promise2 = client
              .mutate({
                mutation,
                optimisticResponse: optimisticResponse2,
                updateQueries,
              })
              .then(res => {
                checkBothMutationsAreApplied(
                  'This one was created with a mutation.',
                  'Second mutation.',
                );
                const latestState = client.queryManager.mutationStore;
                expect(latestState.get('5').loading).toBe(false);
                expect(latestState.get('6').loading).toBe(false);

                return res;
              });

            const mutationsState = client.queryManager.mutationStore;
            expect(mutationsState.get('5').loading).toBe(true);
            expect(mutationsState.get('6').loading).toBe(true);

            checkBothMutationsAreApplied(
              'Optimistically generated',
              'Optimistically generated 2',
            );

            return Promise.all([promise, promise2]);
          })
          .then(() => {
            subscriptionHandle.unsubscribe();
            checkBothMutationsAreApplied(
              'This one was created with a mutation.',
              'Second mutation.',
            );
          });
      });
    });

    describe('with `update`', () => {
      const update = (proxy: any, mResult: any) => {
        const data: any = proxy.readFragment({
          id: 'TodoList5',
          fragment: gql`
            fragment todoList on TodoList {
              todos {
                id
                text
                completed
                __typename
              }
            }
          `,
        });

        proxy.writeFragment({
          data: { ...data, todos: [mResult.data.createTodo, ...data.todos] },
          id: 'TodoList5',
          fragment: gql`
            fragment todoList on TodoList {
              todos {
                id
                text
                completed
                __typename
              }
            }
          `,
        });
      };

      it('handles a single error for a single mutation', () => {
        return setup({
          request: { query: mutation },
          error: new Error('forbidden (test error)'),
        })
          .then(() => {
            const promise = client.mutate({
              mutation,
              optimisticResponse,
              update,
            });

            const dataInStore = (client.queryManager.dataStore.getCache() as InMemoryCache).extract(
              true,
            );
            expect((dataInStore['TodoList5'] as any).todos.length).toBe(4);
            expect((dataInStore['Todo99'] as any).text).toBe(
              'Optimistically generated',
            );

            return promise;
          })
          .catch(err => {
            expect(err).toBeInstanceOf(Error);
            expect(err.message).toBe('Network error: forbidden (test error)');

            const dataInStore = (client.queryManager.dataStore.getCache() as InMemoryCache).extract(
              true,
            );
            expect((dataInStore['TodoList5'] as any).todos.length).toBe(3);
            expect(dataInStore).not.toHaveProperty('Todo99');
          });
      });

      it('handles errors produced by one mutation in a series', () => {
        let subscriptionHandle: Subscription;
        return setup(
          {
            request: { query: mutation },
            error: new Error('forbidden (test error)'),
          },
          {
            request: { query: mutation },
            result: mutationResult2,
          },
        )
          .then(() => {
            // we have to actually subscribe to the query to be able to update it
            return new Promise(resolve => {
              const handle = client.watchQuery({ query });
              subscriptionHandle = handle.subscribe({
                next(res) {
                  resolve(res);
                },
              });
            });
          })
          .then(() => {
            const promise = client
              .mutate({
                mutation,
                optimisticResponse,
                update,
              })
              .catch(err => {
                // it is ok to fail here
                expect(err).toBeInstanceOf(Error);
                expect(err.message).toBe(
                  'Network error: forbidden (test error)',
                );
                return null;
              });

            const promise2 = client.mutate({
              mutation,
              optimisticResponse: optimisticResponse2,
              update,
            });

            const dataInStore = (client.queryManager.dataStore.getCache() as InMemoryCache).extract(
              true,
            );
            expect((dataInStore['TodoList5'] as any).todos.length).toBe(5);
            expect((dataInStore['Todo99'] as any).text).toBe(
              'Optimistically generated',
            );
            expect((dataInStore['Todo66'] as any).text).toBe(
              'Optimistically generated 2',
            );

            return Promise.all([promise, promise2]);
          })
          .then(() => {
            subscriptionHandle.unsubscribe();
            const dataInStore = (client.queryManager.dataStore.getCache() as InMemoryCache).extract(
              true,
            );
            expect((dataInStore['TodoList5'] as any).todos.length).toBe(4);
            expect(dataInStore).not.toHaveProperty('Todo99');
            expect(dataInStore).toHaveProperty('Todo66');
            expect((dataInStore['TodoList5'] as any).todos).toContainEqual(
              realIdValue('Todo66'),
            );
            expect((dataInStore['TodoList5'] as any).todos).not.toContainEqual(
              realIdValue('Todo99'),
            );
          });
      });

      it('can run 2 mutations concurrently and handles all intermediate states well', () => {
        function checkBothMutationsAreApplied(
          expectedText1: any,
          expectedText2: any,
        ) {
          const dataInStore = (client.queryManager.dataStore.getCache() as InMemoryCache).extract(
            true,
          );
          expect((dataInStore['TodoList5'] as any).todos.length).toBe(5);
          expect(dataInStore).toHaveProperty('Todo99');
          expect(dataInStore).toHaveProperty('Todo66');
          expect((dataInStore['TodoList5'] as any).todos).toContainEqual(
            realIdValue('Todo66'),
          );
          expect((dataInStore['TodoList5'] as any).todos).toContainEqual(
            realIdValue('Todo99'),
          );
          expect((dataInStore['Todo99'] as any).text).toBe(expectedText1);
          expect((dataInStore['Todo66'] as any).text).toBe(expectedText2);
        }
        let subscriptionHandle: Subscription;
        return setup(
          {
            request: { query: mutation },
            result: mutationResult,
          },
          {
            request: { query: mutation },
            result: mutationResult2,
            // make sure it always happens later
            delay: 100,
          },
        )
          .then(() => {
            // we have to actually subscribe to the query to be able to update it
            return new Promise(resolve => {
              const handle = client.watchQuery({ query });
              subscriptionHandle = handle.subscribe({
                next(res) {
                  resolve(res);
                },
              });
            });
          })
          .then(() => {
            const promise = client
              .mutate({
                mutation,
                optimisticResponse,
                update,
              })
              .then(res => {
                checkBothMutationsAreApplied(
                  'This one was created with a mutation.',
                  'Optimistically generated 2',
                );
                const latestState = client.queryManager.mutationStore;
                expect(latestState.get('5').loading).toBe(false);
                expect(latestState.get('6').loading).toBe(true);

                return res;
              });

            const promise2 = client
              .mutate({
                mutation,
                optimisticResponse: optimisticResponse2,
                update,
              })
              .then(res => {
                checkBothMutationsAreApplied(
                  'This one was created with a mutation.',
                  'Second mutation.',
                );
                const latestState = client.queryManager.mutationStore;
                expect(latestState.get('5').loading).toBe(false);
                expect(latestState.get('6').loading).toBe(false);

                return res;
              });

            const mutationsState = client.queryManager.mutationStore;
            expect(mutationsState.get('5').loading).toBe(true);
            expect(mutationsState.get('6').loading).toBe(true);

            checkBothMutationsAreApplied(
              'Optimistically generated',
              'Optimistically generated 2',
            );

            return Promise.all([promise, promise2]);
          })
          .then(() => {
            subscriptionHandle.unsubscribe();
            checkBothMutationsAreApplied(
              'This one was created with a mutation.',
              'Second mutation.',
            );
          });
      });
    });
  });

  describe('passing a function to optimisticResponse', () => {
    const mutation = gql`
      mutation createTodo($text: String) {
        createTodo(text: $text) {
          id
          text
          completed
          __typename
        }
        __typename
      }
    `;

    const variables = { text: 'Optimistically generated from variables' };

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

    const optimisticResponse = ({ text }: { text: string }) => ({
      __typename: 'Mutation',
      createTodo: {
        __typename: 'Todo',
        id: '99',
        text,
        completed: true,
      },
    });

    it('will use a passed variable in optimisticResponse', () => {
      let subscriptionHandle: Subscription;
      return setup({
        request: { query: mutation, variables },
        result: mutationResult,
      })
        .then(() => {
          // we have to actually subscribe to the query to be able to update it
          return new Promise(resolve => {
            const handle = client.watchQuery({ query });
            subscriptionHandle = handle.subscribe({
              next(res) {
                resolve(res);
              },
            });
          });
        })
        .then(() => {
          const promise = client.mutate({
            mutation,
            variables,
            optimisticResponse,
            update: (proxy, mResult: any) => {
              expect(mResult.data.createTodo.id).toBe('99');

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
          });

          const dataInStore = (client.queryManager.dataStore.getCache() as InMemoryCache).extract(
            true,
          );
          expect((dataInStore['TodoList5'] as any).todos.length).toEqual(4);
          expect((dataInStore['Todo99'] as any).text).toEqual(
            'Optimistically generated from variables',
          );

          return promise;
        })
        .then(() => {
          return client.query({ query });
        })
        .then((newResult: any) => {
          subscriptionHandle.unsubscribe();
          // There should be one more todo item than before
          expect(newResult.data.todoList.todos.length).toEqual(4);

          // Since we used `prepend` it should be at the front
          expect(newResult.data.todoList.todos[0].text).toEqual(
            'This one was created with a mutation.',
          );
        });
    });
  });

  describe('optimistic updates using `updateQueries`', () => {
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

    type IMutationResult = {
      __typename: string;
      createTodo: {
        id: string;
        __typename: string;
        text: string;
        completed: boolean;
      };
    };

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

    const optimisticResponse = {
      __typename: 'Mutation',
      createTodo: {
        __typename: 'Todo',
        id: '99',
        text: 'Optimistically generated',
        completed: true,
      },
    };

    const mutationResult2 = {
      data: assign({}, mutationResult.data, {
        createTodo: assign({}, mutationResult.data.createTodo, {
          id: '66',
          text: 'Second mutation.',
        }),
      }),
    };

    const optimisticResponse2 = {
      __typename: 'Mutation',
      createTodo: {
        __typename: 'Todo',
        id: '66',
        text: 'Optimistically generated 2',
        completed: true,
      },
    };

    it('will insert a single item to the beginning', () => {
      let subscriptionHandle: Subscription;
      return setup({
        request: { query: mutation },
        result: mutationResult,
      })
        .then(() => {
          // we have to actually subscribe to the query to be able to update it
          return new Promise(resolve => {
            const handle = client.watchQuery({ query });
            subscriptionHandle = handle.subscribe({
              next(res) {
                resolve(res);
              },
            });
          });
        })
        .then(() => {
          const promise = client.mutate({
            mutation,
            optimisticResponse,
            updateQueries: {
              todoList: (prev, options) => {
                const mResult = options.mutationResult as any;
                expect(mResult.data.createTodo.id).toEqual('99');

                const state = cloneDeep(prev) as any;
                state.todoList.todos.unshift(mResult.data.createTodo);
                return state;
              },
            },
          });

          const dataInStore = (client.queryManager.dataStore.getCache() as InMemoryCache).extract(
            true,
          );
          expect((dataInStore['TodoList5'] as any).todos.length).toEqual(4);
          expect((dataInStore['Todo99'] as any).text).toEqual(
            'Optimistically generated',
          );

          return promise;
        })
        .then(() => {
          return client.query({ query });
        })
        .then((newResult: any) => {
          subscriptionHandle.unsubscribe();
          // There should be one more todo item than before
          expect(newResult.data.todoList.todos.length).toEqual(4);

          // Since we used `prepend` it should be at the front
          expect(newResult.data.todoList.todos[0].text).toEqual(
            'This one was created with a mutation.',
          );
        });
    });

    it('two array insert like mutations', () => {
      let subscriptionHandle: Subscription;
      return setup(
        {
          request: { query: mutation },
          result: mutationResult,
        },
        {
          request: { query: mutation },
          result: mutationResult2,
          delay: 50,
        },
      )
        .then(() => {
          // we have to actually subscribe to the query to be able to update it
          return new Promise(resolve => {
            const handle = client.watchQuery({ query });
            subscriptionHandle = handle.subscribe({
              next(res) {
                resolve(res);
              },
            });
          });
        })
        .then(() => {
          const updateQueries = {
            todoList: (prev, options) => {
              const mResult = options.mutationResult;

              const state = cloneDeep<any>(prev);

              if (mResult.data) {
                state.todoList.todos.unshift(mResult.data.createTodo);
              }

              return state;
            },
          } as MutationQueryReducersMap<IMutationResult>;
          const promise = client
            .mutate({
              mutation,
              optimisticResponse,
              updateQueries,
            })
            .then(res => {
              const currentDataInStore = (client.queryManager.dataStore.getCache() as InMemoryCache).extract(
                true,
              );
              expect(
                (currentDataInStore['TodoList5'] as any).todos.length,
              ).toEqual(5);
              expect((currentDataInStore['Todo99'] as any).text).toEqual(
                'This one was created with a mutation.',
              );
              expect((currentDataInStore['Todo66'] as any).text).toEqual(
                'Optimistically generated 2',
              );
              return res;
            });

          const promise2 = client.mutate({
            mutation,
            optimisticResponse: optimisticResponse2,
            updateQueries,
          });

          const dataInStore = (client.queryManager.dataStore.getCache() as InMemoryCache).extract(
            true,
          );
          expect((dataInStore['TodoList5'] as any).todos.length).toEqual(5);
          expect((dataInStore['Todo99'] as any).text).toEqual(
            'Optimistically generated',
          );
          expect((dataInStore['Todo66'] as any).text).toEqual(
            'Optimistically generated 2',
          );

          return Promise.all([promise, promise2]);
        })
        .then(() => {
          return client.query({ query });
        })
        .then((newResult: any) => {
          subscriptionHandle.unsubscribe();
          // There should be one more todo item than before
          expect(newResult.data.todoList.todos.length).toEqual(5);

          // Since we used `prepend` it should be at the front
          expect(newResult.data.todoList.todos[0].text).toEqual(
            'Second mutation.',
          );
          expect(newResult.data.todoList.todos[1].text).toEqual(
            'This one was created with a mutation.',
          );
        });
    });

    it('two mutations, one fails', () => {
      let subscriptionHandle: Subscription;
      return setup(
        {
          request: { query: mutation },
          error: new Error('forbidden (test error)'),
          delay: 20,
        },
        {
          request: { query: mutation },
          result: mutationResult2,
          // XXX this test will uncover a flaw in the design of optimistic responses combined with
          // updateQueries or result reducers if you un-comment the line below. The issue is that
          // optimistic updates are not commutative but are treated as such. When undoing an
          // optimistic update, other optimistic updates should be rolled back and re-applied in the
          // same order as before, otherwise the store can end up in an inconsistent state.
          // delay: 50,
        },
      )
        .then(() => {
          // we have to actually subscribe to the query to be able to update it
          return new Promise(resolve => {
            const handle = client.watchQuery({ query });
            subscriptionHandle = handle.subscribe({
              next(res) {
                resolve(res);
              },
            });
          });
        })
        .then(() => {
          const updateQueries = {
            todoList: (prev, options) => {
              const mResult = options.mutationResult;

              const state = cloneDeep<any>(prev);

              if (mResult.data) {
                state.todoList.todos.unshift(mResult.data.createTodo);
              }

              return state;
            },
          } as MutationQueryReducersMap<IMutationResult>;
          const promise = client
            .mutate({
              mutation,
              optimisticResponse,
              updateQueries,
            })
            .catch(err => {
              // it is ok to fail here
              expect(err).toBeInstanceOf(Error);
              expect(err.message).toEqual(
                'Network error: forbidden (test error)',
              );
              return null;
            });

          const promise2 = client.mutate({
            mutation,
            optimisticResponse: optimisticResponse2,
            updateQueries,
          });

          const dataInStore = (client.queryManager.dataStore.getCache() as InMemoryCache).extract(
            true,
          );
          expect((dataInStore['TodoList5'] as any).todos.length).toEqual(5);
          expect((dataInStore['Todo99'] as any).text).toEqual(
            'Optimistically generated',
          );
          expect((dataInStore['Todo66'] as any).text).toEqual(
            'Optimistically generated 2',
          );

          return Promise.all([promise, promise2]);
        })
        .then(() => {
          subscriptionHandle.unsubscribe();
          const dataInStore = (client.queryManager.dataStore.getCache() as InMemoryCache).extract(
            true,
          );
          expect((dataInStore['TodoList5'] as any).todos.length).toEqual(4);
          expect(dataInStore).not.toHaveProperty('Todo99');
          expect(dataInStore).toHaveProperty('Todo66');
          expect((dataInStore['TodoList5'] as any).todos).toContainEqual(
            realIdValue('Todo66'),
          );
          expect((dataInStore['TodoList5'] as any).todos).not.toContainEqual(
            realIdValue('Todo99'),
          );
        });
    });

    it('will handle dependent updates', done => {
      link = mockSingleLink(
        {
          request: { query },
          result,
        },
        {
          request: { query: mutation },
          result: mutationResult,
          delay: 10,
        },
        {
          request: { query: mutation },
          result: mutationResult2,
          delay: 20,
        },
      );

      const customOptimisticResponse1 = {
        __typename: 'Mutation',
        createTodo: {
          __typename: 'Todo',
          id: 'optimistic-99',
          text: 'Optimistically generated',
          completed: true,
        },
      };

      const customOptimisticResponse2 = {
        __typename: 'Mutation',
        createTodo: {
          __typename: 'Todo',
          id: 'optimistic-66',
          text: 'Optimistically generated 2',
          completed: true,
        },
      };

      const updateQueries = {
        todoList: (prev, options) => {
          const mResult = options.mutationResult;

          const state = cloneDeep<any>(prev);

          if (mResult.data) {
            state.todoList.todos.unshift(mResult.data.createTodo);
          }

          return state;
        },
      } as MutationQueryReducersMap<IMutationResult>;

      client = new ApolloClient({
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

      const defaultTodos = result.data.todoList.todos;
      let count = 0;

      client.watchQuery({ query }).subscribe({
        next: (value: any) => {
          const todos = value.data.todoList.todos;
          switch (count++) {
            case 0:
              expect(defaultTodos).toEqual(todos);
              twoMutations();
              break;
            case 1:
              expect([
                customOptimisticResponse1.createTodo,
                ...defaultTodos,
              ]).toEqual(todos);
              break;
            case 2:
              expect([
                customOptimisticResponse2.createTodo,
                customOptimisticResponse1.createTodo,
                ...defaultTodos,
              ]).toEqual(todos);
              break;
            case 3:
              expect([
                customOptimisticResponse2.createTodo,
                mutationResult.data.createTodo,
                ...defaultTodos,
              ]).toEqual(todos);
              break;
            case 4:
              expect([
                mutationResult2.data.createTodo,
                mutationResult.data.createTodo,
                ...defaultTodos,
              ]).toEqual(todos);
              done();
              break;
            default:
              done.fail(new Error('Next should not have been called again.'));
          }
        },
        error: error => done.fail(error),
      });

      function twoMutations() {
        client
          .mutate({
            mutation,
            optimisticResponse: customOptimisticResponse1,
            updateQueries,
          })
          .catch(error => done.fail(error));

        client
          .mutate({
            mutation,
            optimisticResponse: customOptimisticResponse2,
            updateQueries,
          })
          .catch(error => done.fail(error));
      }
    });
  });

  describe('optimistic updates using `update`', () => {
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

    const optimisticResponse = {
      __typename: 'Mutation',
      createTodo: {
        __typename: 'Todo',
        id: '99',
        text: 'Optimistically generated',
        completed: true,
      },
    };

    const mutationResult2 = {
      data: assign({}, mutationResult.data, {
        createTodo: assign({}, mutationResult.data.createTodo, {
          id: '66',
          text: 'Second mutation.',
        }),
      }),
    };

    const optimisticResponse2 = {
      __typename: 'Mutation',
      createTodo: {
        __typename: 'Todo',
        id: '66',
        text: 'Optimistically generated 2',
        completed: true,
      },
    };

    it('will insert a single item to the beginning', () => {
      let subscriptionHandle: Subscription;
      return setup({
        request: { query: mutation },
        result: mutationResult,
      })
        .then(() => {
          // we have to actually subscribe to the query to be able to update it
          return new Promise(resolve => {
            const handle = client.watchQuery({ query });
            subscriptionHandle = handle.subscribe({
              next(res) {
                resolve(res);
              },
            });
          });
        })
        .then(() => {
          const promise = client.mutate({
            mutation,
            optimisticResponse,
            update: (proxy, mResult: any) => {
              expect(mResult.data.createTodo.id).toBe('99');

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
          });

          const dataInStore = (client.queryManager.dataStore.getCache() as InMemoryCache).extract(
            true,
          );
          expect((dataInStore['TodoList5'] as any).todos.length).toBe(4);
          expect((dataInStore['Todo99'] as any).text).toBe(
            'Optimistically generated',
          );

          return promise;
        })
        .then(() => {
          return client.query({ query });
        })
        .then((newResult: any) => {
          subscriptionHandle.unsubscribe();
          // There should be one more todo item than before
          expect(newResult.data.todoList.todos.length).toBe(4);

          // Since we used `prepend` it should be at the front
          expect(newResult.data.todoList.todos[0].text).toBe(
            'This one was created with a mutation.',
          );
        });
    });

    it('two array insert like mutations', () => {
      let subscriptionHandle: Subscription;
      return setup(
        {
          request: { query: mutation },
          result: mutationResult,
        },
        {
          request: { query: mutation },
          result: mutationResult2,
          delay: 50,
        },
      )
        .then(() => {
          // we have to actually subscribe to the query to be able to update it
          return new Promise(resolve => {
            const handle = client.watchQuery({ query });
            subscriptionHandle = handle.subscribe({
              next(res) {
                resolve(res);
              },
            });
          });
        })
        .then(() => {
          const update = (proxy: any, mResult: any) => {
            const data: any = proxy.readFragment({
              id: 'TodoList5',
              fragment: gql`
                fragment todoList on TodoList {
                  todos {
                    id
                    text
                    completed
                    __typename
                  }
                }
              `,
            });

            proxy.writeFragment({
              data: {
                ...data,
                todos: [mResult.data.createTodo, ...data.todos],
              },
              id: 'TodoList5',
              fragment: gql`
                fragment todoList on TodoList {
                  todos {
                    id
                    text
                    completed
                    __typename
                  }
                }
              `,
            });
          };
          const promise = client
            .mutate({
              mutation,
              optimisticResponse,
              update,
            })
            .then(res => {
              const currentDataInStore = (client.queryManager.dataStore.getCache() as InMemoryCache).extract(
                true,
              );
              expect(
                (currentDataInStore['TodoList5'] as any).todos.length,
              ).toBe(5);
              expect((currentDataInStore['Todo99'] as any).text).toBe(
                'This one was created with a mutation.',
              );
              expect((currentDataInStore['Todo66'] as any).text).toBe(
                'Optimistically generated 2',
              );
              return res;
            });

          const promise2 = client.mutate({
            mutation,
            optimisticResponse: optimisticResponse2,
            update,
          });

          const dataInStore = (client.queryManager.dataStore.getCache() as InMemoryCache).extract(
            true,
          );
          expect((dataInStore['TodoList5'] as any).todos.length).toBe(5);
          expect((dataInStore['Todo99'] as any).text).toBe(
            'Optimistically generated',
          );
          expect((dataInStore['Todo66'] as any).text).toBe(
            'Optimistically generated 2',
          );

          return Promise.all([promise, promise2]);
        })
        .then(() => {
          return client.query({ query });
        })
        .then((newResult: any) => {
          subscriptionHandle.unsubscribe();
          // There should be one more todo item than before
          expect(newResult.data.todoList.todos.length).toBe(5);

          // Since we used `prepend` it should be at the front
          expect(newResult.data.todoList.todos[0].text).toBe(
            'Second mutation.',
          );
          expect(newResult.data.todoList.todos[1].text).toBe(
            'This one was created with a mutation.',
          );
        });
    });

    it('two mutations, one fails', () => {
      let subscriptionHandle: Subscription;
      return setup(
        {
          request: { query: mutation },
          error: new Error('forbidden (test error)'),
          delay: 20,
        },
        {
          request: { query: mutation },
          result: mutationResult2,
          // XXX this test will uncover a flaw in the design of optimistic responses combined with
          // updateQueries or result reducers if you un-comment the line below. The issue is that
          // optimistic updates are not commutative but are treated as such. When undoing an
          // optimistic update, other optimistic updates should be rolled back and re-applied in the
          // same order as before, otherwise the store can end up in an inconsistent state.
          // delay: 50,
        },
      )
        .then(() => {
          // we have to actually subscribe to the query to be able to update it
          return new Promise(resolve => {
            const handle = client.watchQuery({ query });
            subscriptionHandle = handle.subscribe({
              next(res) {
                resolve(res);
              },
            });
          });
        })
        .then(() => {
          const update = (proxy: any, mResult: any) => {
            const data: any = proxy.readFragment({
              id: 'TodoList5',
              fragment: gql`
                fragment todoList on TodoList {
                  todos {
                    id
                    text
                    completed
                    __typename
                  }
                }
              `,
            });

            proxy.writeFragment({
              data: {
                ...data,
                todos: [mResult.data.createTodo, ...data.todos],
              },
              id: 'TodoList5',
              fragment: gql`
                fragment todoList on TodoList {
                  todos {
                    id
                    text
                    completed
                    __typename
                  }
                }
              `,
            });
          };
          const promise = client
            .mutate({
              mutation,
              optimisticResponse,
              update,
            })
            .catch(err => {
              // it is ok to fail here
              expect(err).toBeInstanceOf(Error);
              expect(err.message).toBe('Network error: forbidden (test error)');
              return null;
            });

          const promise2 = client.mutate({
            mutation,
            optimisticResponse: optimisticResponse2,
            update,
          });

          const dataInStore = (client.queryManager.dataStore.getCache() as InMemoryCache).extract(
            true,
          );
          expect((dataInStore['TodoList5'] as any).todos.length).toBe(5);
          expect((dataInStore['Todo99'] as any).text).toBe(
            'Optimistically generated',
          );
          expect((dataInStore['Todo66'] as any).text).toBe(
            'Optimistically generated 2',
          );

          return Promise.all([promise, promise2]);
        })
        .then(() => {
          subscriptionHandle.unsubscribe();
          const dataInStore = (client.queryManager.dataStore.getCache() as InMemoryCache).extract(
            true,
          );
          expect((dataInStore['TodoList5'] as any).todos.length).toBe(4);
          expect(dataInStore).not.toHaveProperty('Todo99');
          expect(dataInStore).toHaveProperty('Todo66');
          expect((dataInStore['TodoList5'] as any).todos).toContainEqual(
            realIdValue('Todo66'),
          );
          expect((dataInStore['TodoList5'] as any).todos).not.toContainEqual(
            realIdValue('Todo99'),
          );
        });
    });

    it('will handle dependent updates', done => {
      link = mockSingleLink(
        {
          request: { query },
          result,
        },
        {
          request: { query: mutation },
          result: mutationResult,
          delay: 10,
        },
        {
          request: { query: mutation },
          result: mutationResult2,
          delay: 20,
        },
      );

      const customOptimisticResponse1 = {
        __typename: 'Mutation',
        createTodo: {
          __typename: 'Todo',
          id: 'optimistic-99',
          text: 'Optimistically generated',
          completed: true,
        },
      };

      const customOptimisticResponse2 = {
        __typename: 'Mutation',
        createTodo: {
          __typename: 'Todo',
          id: 'optimistic-66',
          text: 'Optimistically generated 2',
          completed: true,
        },
      };

      const update = (proxy: any, mResult: any) => {
        const data: any = proxy.readFragment({
          id: 'TodoList5',
          fragment: gql`
            fragment todoList on TodoList {
              todos {
                id
                text
                completed
                __typename
              }
            }
          `,
        });

        proxy.writeFragment({
          data: { ...data, todos: [mResult.data.createTodo, ...data.todos] },
          id: 'TodoList5',
          fragment: gql`
            fragment todoList on TodoList {
              todos {
                id
                text
                completed
                __typename
              }
            }
          `,
        });
      };

      client = new ApolloClient({
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

      const defaultTodos = result.data.todoList.todos;
      let count = 0;

      client.watchQuery({ query }).subscribe({
        next: (value: any) => {
          const todos = value.data.todoList.todos;
          switch (count++) {
            case 0:
              expect(defaultTodos).toEqual(todos);
              twoMutations();
              break;
            case 1:
              expect([
                customOptimisticResponse1.createTodo,
                ...defaultTodos,
              ]).toEqual(todos);
              break;
            case 2:
              expect([
                customOptimisticResponse2.createTodo,
                customOptimisticResponse1.createTodo,
                ...defaultTodos,
              ]).toEqual(todos);
              break;
            case 3:
              expect([
                customOptimisticResponse2.createTodo,
                mutationResult.data.createTodo,
                ...defaultTodos,
              ]).toEqual(todos);
              break;
            case 4:
              expect([
                mutationResult2.data.createTodo,
                mutationResult.data.createTodo,
                ...defaultTodos,
              ]).toEqual(todos);
              done();
              break;
            default:
              done.fail(new Error('Next should not have been called again.'));
          }
        },
        error: error => done.fail(error),
      });

      function twoMutations() {
        client
          .mutate({
            mutation,
            optimisticResponse: customOptimisticResponse1,
            update,
          })
          .catch(error => done.fail(error));

        client
          .mutate({
            mutation,
            optimisticResponse: customOptimisticResponse2,
            update,
          })
          .catch(error => done.fail(error));
      }
    });
  });
});

describe('optimistic mutation - githunt comments', () => {
  const query = gql`
    query Comment($repoName: String!) {
      entry(repoFullName: $repoName) {
        comments {
          postedBy {
            login
            html_url
          }
        }
      }
    }
  `;
  const queryWithFragment = gql`
    query Comment($repoName: String!) {
      entry(repoFullName: $repoName) {
        comments {
          ...authorFields
        }
      }
    }

    fragment authorFields on User {
      postedBy {
        login
        html_url
      }
    }
  `;
  const variables = {
    repoName: 'org/repo',
  };
  const userDoc = {
    __typename: 'User',
    login: 'stubailo',
    html_url: 'http://avatar.com/stubailo.png',
  };

  const result = {
    data: {
      __typename: 'Query',
      entry: {
        __typename: 'Entry',
        comments: [
          {
            __typename: 'Comment',
            postedBy: userDoc,
          },
        ],
      },
    },
  };

  let client: ApolloClient;
  let link: any;

  function setup(...mockedResponses: any[]) {
    link = mockSingleLink(
      {
        request: {
          query: addTypenameToDocument(query),
          variables,
        },
        result,
      },
      {
        request: {
          query: addTypenameToDocument(queryWithFragment),
          variables,
        },
        result,
      },
      ...mockedResponses,
    );

    client = new ApolloClient({
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

    const obsHandle = client.watchQuery({
      query,
      variables,
    });

    return obsHandle.result();
  }

  const mutation = gql`
    mutation submitComment($repoFullName: String!, $commentContent: String!) {
      submitComment(
        repoFullName: $repoFullName
        commentContent: $commentContent
      ) {
        postedBy {
          login
          html_url
        }
      }
    }
  `;

  type IMutationResult = {
    __typename: string;
    submitComment: {
      __typename: string;
      postedBy: {
        __typename: string;
        login: string;
        html_url: string;
      };
    };
  };
  const mutationResult = {
    data: {
      __typename: 'Mutation',
      submitComment: {
        __typename: 'Comment',
        postedBy: userDoc,
      },
    },
  };
  const updateQueries = {
    Comment: (prev, { mutationResult: mutationResultArg }) => {
      if (mutationResultArg.data) {
        const newComment = mutationResultArg.data.submitComment;
        const state = cloneDeep<any>(prev);
        state.entry.comments.unshift(newComment);
        return state;
      }

      return prev;
    },
  } as MutationQueryReducersMap<IMutationResult>;
  const optimisticResponse = {
    __typename: 'Mutation',
    submitComment: {
      __typename: 'Comment',
      postedBy: userDoc,
    },
  };

  it('can post a new comment', () => {
    const mutationVariables = {
      repoFullName: 'org/repo',
      commentContent: 'New Comment',
    };

    let subscriptionHandle: Subscription;
    return setup({
      request: {
        query: addTypenameToDocument(mutation),
        variables: mutationVariables,
      },
      result: mutationResult,
    })
      .then(() => {
        // we have to actually subscribe to the query to be able to update it
        return new Promise(resolve => {
          const handle = client.watchQuery({ query, variables });
          subscriptionHandle = handle.subscribe({
            next(res) {
              resolve(res);
            },
          });
        });
      })
      .then(() => {
        return client.mutate({
          mutation,
          optimisticResponse,
          variables: mutationVariables,
          updateQueries,
        });
      })
      .then(() => {
        return client.query({ query, variables });
      })
      .then((newResult: any) => {
        subscriptionHandle.unsubscribe();
        expect(newResult.data.entry.comments.length).toBe(2);
      });
  });
});

function realIdValue(id: string) {
  return {
    type: 'id',
    generated: false,
    id,
  };
}
