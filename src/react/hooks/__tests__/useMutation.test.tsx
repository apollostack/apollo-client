import React, { useEffect } from 'react';
import { GraphQLError } from 'graphql';
import gql from 'graphql-tag';
import { render, cleanup, wait } from '@testing-library/react';

import { ApolloClient, ApolloLink, ApolloQueryResult, Cache, NetworkStatus, Observable, ObservableQuery, TypedDocumentNode } from '../../../core';
import { InMemoryCache } from '../../../cache';
import { itAsync, MockedProvider, mockSingleLink } from '../../../testing';
import { ApolloProvider } from '../../context';
import { useQuery } from '../useQuery';
import { useMutation } from '../useMutation';
import { act } from 'react-dom/test-utils';

describe('useMutation Hook', () => {
  interface Todo {
    id: number;
    description: string;
    priority: string;
  }

  const CREATE_TODO_MUTATION = gql`
    mutation createTodo($description: String!, $priority: String) {
      createTodo(description: $description, priority: $priority) {
        id
        description
        priority
      }
    }
  `;

  const CREATE_TODO_RESULT = {
    createTodo: {
      id: 1,
      description: 'Get milk!',
      priority: 'High',
      __typename: 'Todo'
    }
  };

  const CREATE_TODO_ERROR = 'Failed to create item';

  afterEach(cleanup);

  describe('General use', () => {
    it('should handle a simple mutation properly', async () => {
      const variables = {
        description: 'Get milk!'
      };

      const mocks = [
        {
          request: {
            query: CREATE_TODO_MUTATION,
            variables
          },
          result: { data: CREATE_TODO_RESULT }
        }
      ];

      let renderCount = 0;
      const Component = () => {
        const [createTodo, { loading, data }] = useMutation(
          CREATE_TODO_MUTATION
        );
        switch (renderCount) {
          case 0:
            expect(loading).toBeFalsy();
            expect(data).toBeUndefined();
            createTodo({ variables });
            break;
          case 1:
            expect(loading).toBeTruthy();
            expect(data).toBeUndefined();
            break;
          case 2:
            expect(loading).toBeFalsy();
            expect(data).toEqual(CREATE_TODO_RESULT);
            break;
          default:
        }
        renderCount += 1;
        return null;
      };

      render(
        <MockedProvider mocks={mocks}>
          <Component />
        </MockedProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(3);
      });
    });

    it('should be able to call mutations as an effect', async () => {
      const variables = {
        description: 'Get milk!'
      };

      const mocks = [
        {
          request: {
            query: CREATE_TODO_MUTATION,
            variables
          },
          result: { data: CREATE_TODO_RESULT }
        }
      ];

      let renderCount = 0;
      const useCreateTodo = () => {
        const [createTodo, { loading, data }] = useMutation(
          CREATE_TODO_MUTATION
        );

        useEffect(() => {
          createTodo({ variables });
        }, [variables]);

        switch (renderCount) {
          case 0:
            expect(loading).toBeFalsy();
            expect(data).toBeUndefined();
            break;
          case 1:
            expect(loading).toBeTruthy();
            expect(data).toBeUndefined();
            break;
          case 2:
            expect(loading).toBeFalsy();
            expect(data).toEqual(CREATE_TODO_RESULT);
            break;
          default:
        }
        renderCount += 1;
        return null;
      };

      const Component = () => {
        useCreateTodo();
        return null;
      };

      render(
        <MockedProvider mocks={mocks}>
          <Component />
        </MockedProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(3);
      });
    });

    it('should ensure the mutation callback function has a stable identity', async () => {
      const variables = {
        description: 'Get milk!'
      };

      const mocks = [
        {
          request: {
            query: CREATE_TODO_MUTATION,
            variables
          },
          result: { data: CREATE_TODO_RESULT }
        }
      ];

      let mutationFn: any;
      let renderCount = 0;
      const Component = () => {
        const [createTodo, { loading, data }] = useMutation(
          CREATE_TODO_MUTATION
        );
        switch (renderCount) {
          case 0:
            mutationFn = createTodo;
            expect(loading).toBeFalsy();
            expect(data).toBeUndefined();
            setTimeout(() => {
              createTodo({ variables });
            });
            break;
          case 1:
            expect(mutationFn).toBe(createTodo);
            expect(loading).toBeTruthy();
            expect(data).toBeUndefined();
            break;
          case 2:
            expect(loading).toBeFalsy();
            expect(data).toEqual(CREATE_TODO_RESULT);
            break;
          default:
        }
        renderCount += 1;
        return null;
      };

      render(
        <MockedProvider mocks={mocks}>
          <Component />
        </MockedProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(3);
      });
    });

    it('should resolve mutate function promise with mutation results', async () => {
      const variables = {
        description: 'Get milk!'
      };

      const mocks = [
        {
          request: {
            query: CREATE_TODO_MUTATION,
            variables
          },
          result: { data: CREATE_TODO_RESULT }
        }
      ];

      const Component = () => {
        const [createTodo] = useMutation<{ createTodo: Todo }>(
          CREATE_TODO_MUTATION
        );

        async function doIt() {
          const { data } = await createTodo({ variables });
          expect(data).toEqual(CREATE_TODO_RESULT);
          expect(data!.createTodo.description).toEqual(
            CREATE_TODO_RESULT.createTodo.description
          );
        }

        useEffect(() => {
          doIt();
        }, []);

        return null;
      };

      render(
        <MockedProvider mocks={mocks}>
          <Component />
        </MockedProvider>
      );

      return wait();
    });

    describe('mutate function upon error', () => {
      itAsync('resolves with the resulting data and errors', async (resolve, reject) => {
        const variables = {
          description: 'Get milk!'
        };

        const mocks = [
          {
            request: {
              query: CREATE_TODO_MUTATION,
              variables
            },
            result: {
              data: CREATE_TODO_RESULT,
              errors: [new GraphQLError(CREATE_TODO_ERROR)],
            },
          }
        ];

        let fetchResult: any;
        const Component = () => {
          const [createTodo] = useMutation<{ createTodo: Todo }>(
            CREATE_TODO_MUTATION,
            {
              onError: error => {
                expect(error.message).toEqual(CREATE_TODO_ERROR);
              }
            }
          );

          async function runMutation() {
            fetchResult = await createTodo({ variables });
          }

          useEffect(() => {
            runMutation();
          }, []);

          return null;
        };

        render(
          <MockedProvider mocks={mocks}>
            <Component />
          </MockedProvider>
        );

        await wait(() => {
          expect(fetchResult.data).toEqual(undefined);
          expect(fetchResult.errors.message).toEqual(CREATE_TODO_ERROR);
        }).then(resolve, reject);
      });

      it(`should reject when errorPolicy is 'none'`, async () => {
        const variables = {
          description: 'Get milk!'
        };

        const mocks = [
          {
            request: {
              query: CREATE_TODO_MUTATION,
              variables
            },
            result: {
              data: CREATE_TODO_RESULT,
              errors: [new GraphQLError(CREATE_TODO_ERROR)],
            },
          }
        ];

        const Component = () => {
          const [createTodo] = useMutation<{ createTodo: Todo }>(
            CREATE_TODO_MUTATION,
            { errorPolicy: 'none' }
          );

          async function doIt() {
            try {
              await createTodo({ variables });
            } catch (error) {
              expect(error.message).toEqual(
                expect.stringContaining(CREATE_TODO_ERROR)
              );
            }
          }

          useEffect(() => {
            doIt();
          }, []);

          return null;
        };

        render(
          <MockedProvider mocks={mocks}>
            <Component />
          </MockedProvider>
        );

        return wait();
      });

      it(`should resolve with 'data' and 'error' properties when errorPolicy is 'all'`, async () => {
        const variables = {
          description: 'Get milk!'
        };

        const mocks = [
          {
            request: {
              query: CREATE_TODO_MUTATION,
              variables
            },
            result: {
              data: CREATE_TODO_RESULT,
              errors: [new GraphQLError(CREATE_TODO_ERROR)],
            },
          }
        ];

        const Component = () => {
          const [createTodo] = useMutation<{ createTodo: Todo }>(
            CREATE_TODO_MUTATION,
            { errorPolicy: 'all' }
          );

          async function doIt() {
            const { data, errors } = await createTodo({ variables });

            expect(data).toEqual(CREATE_TODO_RESULT);
            expect(data!.createTodo.description).toEqual(
              CREATE_TODO_RESULT.createTodo.description
            );
            expect(errors![0].message).toEqual(
              expect.stringContaining(CREATE_TODO_ERROR)
            );
          }

          useEffect(() => {
            doIt();
          }, []);

          return null;
        };

        render(
          <MockedProvider mocks={mocks}>
            <Component />
          </MockedProvider>
        );

        return wait();
      })
    });

    it('should return the current client instance in the result object', async () => {
      const Component = () => {
        const [, { client }] = useMutation(CREATE_TODO_MUTATION);
        expect(client).toBeDefined();
        expect(client instanceof ApolloClient).toBeTruthy();
        return null;
      };

      render(
        <MockedProvider>
          <Component />
        </MockedProvider>
      );

      return wait();
    });

    it('should merge provided variables', async () => {
      const mocks = [
        {
          request: {
            query: CREATE_TODO_MUTATION,
            variables: {
              priority: 'Low',
              description: 'Get milk.'
            }
          },
          result: {
            data: {
              createTodo: {
                id: 1,
                description: 'Get milk!',
                priority: 'Low',
                __typename: 'Todo'
              }
            }
          }
        }
      ];

      const Component = () => {
        const [createTodo, result] = useMutation<
          { createTodo: Todo },
          { priority?: string, description?: string }
        >(CREATE_TODO_MUTATION, {
          variables: { priority: 'Low' }
        });

        useEffect(() => {
          createTodo({ variables: { description: 'Get milk.' } })
        }, []);

        return (
          <>
            {result.data ? JSON.stringify(result.data.createTodo) : null}
          </>
        );
      };

      const {getByText} = render(
        <MockedProvider mocks={mocks}>
          <Component />
        </MockedProvider>
      );

      await wait(() => {
        getByText('{"id":1,"description":"Get milk!","priority":"Low","__typename":"Todo"}')
      });
    });
  });

  describe('ROOT_MUTATION cache data', () => {
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

    itAsync('should be removed by default after the mutation', (resolve, reject) => {
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

      let renderCount = 0;
      function Component() {
        // This test differs from the following test primarily by *not* passing
        // keepRootFields: true in the useMutation options.
        const [mutate, result] = useMutation(mutation);

        switch (++renderCount) {
          case 1: {
            expect(result.loading).toBe(false);
            expect(result.called).toBe(false);
            expect(result.data).toBeUndefined();

            mutate({
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
                // The contents of the ROOT_MUTATION object exist only briefly,
                // for the duration of the mutation update, and are removed
                // after the mutation write is finished.
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
              // The contents of the ROOT_MUTATION object exist only briefly,
              // for the duration of the mutation update, and are removed after
              // the mutation write is finished.
              expect(client.cache.extract()).toEqual({
                ROOT_MUTATION: {
                  __typename: "Mutation",
                },
              });
            }).catch(reject);

            break;
          }
          case 2: {
            expect(result.loading).toBe(true);
            expect(result.called).toBe(true);
            expect(result.data).toBeUndefined();
            break;
          }
          case 3: {
            expect(result.loading).toBe(false);
            expect(result.called).toBe(true);
            const {
              doSomething: {
                __typename,
                time,
              },
            } = result.data;
            expect(__typename).toBe("MutationPayload");
            expect(time).toBeInstanceOf(Date);
            expect(time.getTime()).toBe(startTime);
            break;
          }
          default:
            console.log(result);
            reject("too many renders");
            break;
        }

        return null;
      }

      render(
        <ApolloProvider client={client}>
          <Component />
        </ApolloProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(3);
      }).then(resolve, reject);
    });

    itAsync('can be preserved by passing keepRootFields: true', (resolve, reject) => {
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

      let renderCount = 0;
      function Component() {
        const [mutate, result] = useMutation(mutation, {
          // This test differs from the previous test primarily by passing
          // keepRootFields:true in the useMutation options.
          keepRootFields: true,
        });

        switch (++renderCount) {
          case 1: {
            expect(result.loading).toBe(false);
            expect(result.called).toBe(false);
            expect(result.data).toBeUndefined();

            mutate({
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
            }).catch(reject);

            break;
          }
          case 2: {
            expect(result.loading).toBe(true);
            expect(result.called).toBe(true);
            expect(result.data).toBeUndefined();
            break;
          }
          case 3: {
            expect(result.loading).toBe(false);
            expect(result.called).toBe(true);
            const {
              doSomething: {
                __typename,
                time,
              },
            } = result.data;
            expect(__typename).toBe("MutationPayload");
            expect(time).toBeInstanceOf(Date);
            expect(time.getTime()).toBe(startTime);
            break;
          }
          default:
            console.log(result);
            reject("too many renders");
            break;
        }

        return null;
      }

      render(
        <ApolloProvider client={client}>
          <Component />
        </ApolloProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(3);
      }).then(resolve, reject);
    });
  });

  describe('Update function', () => {
    itAsync('should be called with the provided variables', (resolve, reject) => {
      const variables = {
        description: 'Get milk!'
      };

      const mocks = [
        {
          request: {
            query: CREATE_TODO_MUTATION,
            variables
          },
          result: { data: CREATE_TODO_RESULT }
        }
      ];

      let variablesMatched = false;
      const Component = () => {
        const [createTodo] = useMutation(
          CREATE_TODO_MUTATION,
          {
            update(_, __, options) {
              expect(options.variables).toEqual(variables);
              variablesMatched = true;
            }
          }
        );

        useEffect(() => {
          createTodo({ variables });
        }, []);

        return null;
      };

      render(
        <MockedProvider mocks={mocks}>
          <Component />
        </MockedProvider>
      );

      return wait(() => {
        expect(variablesMatched).toBe(true);
      }).then(resolve, reject);
    });

    itAsync('should be called with the provided context', (resolve, reject) => {
      const context = { id: 3 };

      const variables = {
        description: 'Get milk!'
      };

      const mocks = [
        {
          request: {
            query: CREATE_TODO_MUTATION,
            variables
          },
          result: { data: CREATE_TODO_RESULT }
        }
      ];

      let foundContext = false;
      const Component = () => {
        const [createTodo] = useMutation<Todo, { description: string }, { id: number }>(
          CREATE_TODO_MUTATION,
          {
            context,
            update(_, __, options) {
              expect(options.context).toEqual(context);
              foundContext = true;
            }
          }
        );

        useEffect(() => {
          createTodo({ variables });
        }, []);

        return null;
      };

      render(
        <MockedProvider mocks={mocks}>
          <Component />
        </MockedProvider>
      );

      return wait(() => {
        expect(foundContext).toBe(true);
      }).then(resolve, reject);
    });

    describe('If context is not provided', () => {
      itAsync('should be undefined', (resolve, reject) => {
        const variables = {
          description: 'Get milk!'
        };

        const mocks = [
          {
            request: {
              query: CREATE_TODO_MUTATION,
              variables
            },
            result: { data: CREATE_TODO_RESULT }
          }
        ];

        let checkedContext = false;
        const Component = () => {
          const [createTodo] = useMutation(
            CREATE_TODO_MUTATION,
            {
              update(_, __, options) {
                expect(options.context).toBeUndefined();
                checkedContext = true;
              }
            }
          );

          useEffect(() => {
            createTodo({ variables });
          }, []);

          return null;
        };

        render(
          <MockedProvider mocks={mocks}>
            <Component />
          </MockedProvider>
        );

        return wait(() => {
          expect(checkedContext).toBe(true);
        }).then(resolve, reject);
      });
    });
  });

  describe('Optimistic response', () => {
    itAsync('should support optimistic response handling', async (resolve, reject) => {
      const optimisticResponse = {
        __typename: 'Mutation',
        createTodo: {
          id: 1,
          description: 'TEMPORARY',
          priority: 'High',
          __typename: 'Todo'
        }
      };

      const variables = {
        description: 'Get milk!'
      };

      const mocks = [
        {
          request: {
            query: CREATE_TODO_MUTATION,
            variables
          },
          result: { data: CREATE_TODO_RESULT }
        }
      ];

      const link = mockSingleLink(...mocks).setOnError(reject);
      const cache = new InMemoryCache();
      const client = new ApolloClient({
        cache,
        link
      });

      let renderCount = 0;
      const Component = () => {
        const [createTodo, { loading, data }] = useMutation(
          CREATE_TODO_MUTATION,
          { optimisticResponse }
        );

        switch (renderCount) {
          case 0:
            expect(loading).toBeFalsy();
            expect(data).toBeUndefined();
            createTodo({ variables });

            const dataInStore = client.cache.extract(true);
            expect(dataInStore['Todo:1']).toEqual(
              optimisticResponse.createTodo
            );

            break;
          case 1:
            expect(loading).toBeTruthy();
            expect(data).toBeUndefined();
            break;
          case 2:
            expect(loading).toBeFalsy();
            expect(data).toEqual(CREATE_TODO_RESULT);
            break;
          default:
        }
        renderCount += 1;
        return null;
      };

      render(
        <ApolloProvider client={client}>
          <Component />
        </ApolloProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(3);
      }).then(resolve, reject);
    });

    itAsync('should be called with the provided context', async (resolve, reject) => {
      const optimisticResponse = {
        __typename: 'Mutation',
        createTodo: {
          id: 1,
          description: 'TEMPORARY',
          priority: 'High',
          __typename: 'Todo'
        }
      };

      const context = { id: 3 };

      const variables = {
        description: 'Get milk!'
      };

      const mocks = [
        {
          request: {
            query: CREATE_TODO_MUTATION,
            variables
          },
          result: { data: CREATE_TODO_RESULT }
        }
      ];

      const contextFn = jest.fn();

      const Component = () => {
        const [createTodo] = useMutation(
          CREATE_TODO_MUTATION,
          {
            optimisticResponse,
            context,
            update(_, __, options) {
              contextFn(options.context);
            }
          }
        );

        useEffect(() => {
          createTodo({ variables });
        }, []);

        return null;
      };

      render(
        <MockedProvider mocks={mocks}>
          <Component />
        </MockedProvider>
      );

      return wait(() => {
        expect(contextFn).toHaveBeenCalledTimes(2);
        expect(contextFn).toHaveBeenCalledWith(context);
      }).then(resolve, reject);
    });
  });

  describe('refetching queries', () => {
    itAsync('can pass onQueryUpdated to useMutation', (resolve, reject) => {
      interface TData {
        todoCount: number;
      }
      const countQuery: TypedDocumentNode<TData> = gql`
        query Count { todoCount @client }
      `;

      const optimisticResponse = {
        __typename: 'Mutation',
        createTodo: {
          id: 1,
          description: 'TEMPORARY',
          priority: 'High',
          __typename: 'Todo'
        }
      };

      const variables = {
        description: 'Get milk!'
      };

      const client = new ApolloClient({
        cache: new InMemoryCache({
          typePolicies: {
            Query: {
              fields: {
                todoCount(count = 0) {
                  return count;
                },
              },
            },
          },
        }),

        link: mockSingleLink({
          request: {
            query: CREATE_TODO_MUTATION,
            variables,
          },
          result: { data: CREATE_TODO_RESULT },
        }).setOnError(reject),
      });

      // The goal of this test is to make sure onQueryUpdated gets called as
      // part of the createTodo mutation, so we use this reobservePromise to
      // await the calling of onQueryUpdated.
      interface OnQueryUpdatedResults {
        obsQuery: ObservableQuery;
        diff: Cache.DiffResult<TData>;
        result: ApolloQueryResult<TData>;
      }
      let resolveOnUpdate: (results: OnQueryUpdatedResults) => any;
      const onUpdatePromise = new Promise<OnQueryUpdatedResults>(resolve => {
        resolveOnUpdate = resolve;
      });
      let finishedReobserving = false;

      let renderCount = 0;
      function Component() {
        const count = useQuery(countQuery);

        const [createTodo, { loading, data }] =
          useMutation(CREATE_TODO_MUTATION, {
            optimisticResponse,

            update(cache, mutationResult) {
              const result = cache.readQuery({
                query: countQuery,
              });

              cache.writeQuery({
                query: countQuery,
                data: {
                  todoCount: (result ? result.todoCount : 0) + 1,
                },
              });
            },
          });

        switch (++renderCount) {
          case 1:
            expect(count.loading).toBe(false);
            expect(count.data).toEqual({ todoCount: 0 });

            expect(loading).toBeFalsy();
            expect(data).toBeUndefined();

            act(() => {
              createTodo({
                variables,
                onQueryUpdated(obsQuery, diff) {
                  return obsQuery.reobserve().then(result => {
                    finishedReobserving = true;
                    resolveOnUpdate({ obsQuery, diff, result });
                    return result;
                  });
                },
              });
            });

            break;
          case 2:
            expect(count.loading).toBe(false);
            expect(count.data).toEqual({ todoCount: 0 });

            expect(loading).toBeTruthy();
            expect(data).toBeUndefined();

            expect(finishedReobserving).toBe(false);
            break;
          case 3:
            expect(count.loading).toBe(false);
            expect(count.data).toEqual({ todoCount: 1 });

            expect(loading).toBe(true);
            expect(data).toBeUndefined();

            expect(finishedReobserving).toBe(false);
            break;
          case 4:
            expect(count.loading).toBe(false);
            expect(count.data).toEqual({ todoCount: 1 });

            expect(loading).toBe(false);
            expect(data).toEqual(CREATE_TODO_RESULT);

            expect(finishedReobserving).toBe(true);
            break;
          default:
            reject("too many renders");
        }

        return null;
      }

      render(
        <ApolloProvider client={client}>
          <Component />
        </ApolloProvider>
      );

      return wait(() => onUpdatePromise.then(results => {
        expect(finishedReobserving).toBe(true);
        expect(renderCount).toBe(4);

        expect(results.diff).toEqual({
          complete: true,
          result: {
            todoCount: 1,
          },
        });

        expect(results.result).toEqual({
          loading: false,
          networkStatus: NetworkStatus.ready,
          data: {
            todoCount: 1,
          },
        });
      })).then(resolve, reject);
    });

    const GET_TODOS_QUERY = gql`
      query getTodos {
        todos {
          id
          description
          priority
        }
      }
    `;

    const GET_TODOS_RESULT_1 = {
      todos: [
        {
          id: 2,
          description: 'Walk the dog',
          priority: 'Medium',
          __typename: 'Todo'
        },
        {
          id: 3,
          description: 'Call mom',
          priority: 'Low',
          __typename: 'Todo'
        },
      ],
    };

    const GET_TODOS_RESULT_2 = {
      todos: [
        {
          id: 1,
          description: 'Get milk!',
          priority: 'High',
          __typename: 'Todo'
        },
        {
          id: 2,
          description: 'Walk the dog',
          priority: 'Medium',
          __typename: 'Todo'
        },
        {
          id: 3,
          description: 'Call mom',
          priority: 'Low',
          __typename: 'Todo'
        },
      ],
    };

    itAsync('refetchQueries with operation names should update cache', async (resolve, reject) => {
      const variables = { description: 'Get milk!' };
      const mocks = [
        {
          request: {
            query: GET_TODOS_QUERY,
          },
          result: { data: GET_TODOS_RESULT_1 },
        },
        {
          request: {
            query: CREATE_TODO_MUTATION,
            variables,
          },
          result: {
            data: CREATE_TODO_RESULT,
          },
        },
        {
          request: {
            query: GET_TODOS_QUERY,
          },
          result: { data: GET_TODOS_RESULT_2 },
        },
      ];

      const link = mockSingleLink(...mocks).setOnError(reject);
      const client = new ApolloClient({
        link,
        cache: new InMemoryCache(),
      });

      let renderCount = 0;
      const QueryComponent = () => {
        const { loading, data } = useQuery(GET_TODOS_QUERY);
        const [mutate] = useMutation(CREATE_TODO_MUTATION);
        switch (++renderCount) {
          case 1:
            expect(loading).toBe(true);
            expect(data).toBeUndefined();
            break;
          case 2:
            expect(loading).toBe(false);
            expect(data).toEqual(mocks[0].result.data);
            setTimeout(() => {
              act(() => {
                mutate({
                  variables,
                  refetchQueries: ['getTodos'],
                });
              });
            });
            break;
          case 3:
          case 4:
            expect(loading).toBe(false);
            expect(data).toEqual(mocks[0].result.data);
            break;
          case 5:
            expect(loading).toBe(false);
            expect(data).toEqual(mocks[2].result.data);
            break;
          default:
            reject("too many renders");
        }

        return null;
      };

      render(
        <ApolloProvider client={client}>
          <QueryComponent />
        </ApolloProvider>
      );

      return wait(() => expect(renderCount).toBe(5))
        .then(() => {
          expect(client.readQuery({ query: GET_TODOS_QUERY}))
            .toEqual(mocks[2].result.data);
        })
        .then(resolve, reject);
    });

    itAsync('refetchQueries with document nodes should update cache', async (resolve, reject) => {
      const variables = { description: 'Get milk!' };
      const mocks = [
        {
          request: {
            query: GET_TODOS_QUERY,
          },
          result: { data: GET_TODOS_RESULT_1 },
        },
        {
          request: {
            query: CREATE_TODO_MUTATION,
            variables,
          },
          result: {
            data: CREATE_TODO_RESULT,
          },
        },
        {
          request: {
            query: GET_TODOS_QUERY,
          },
          result: { data: GET_TODOS_RESULT_2 },
        },
      ];

      const link = mockSingleLink(...mocks).setOnError(reject);
      const client = new ApolloClient({
        link,
        cache: new InMemoryCache(),
      });

      let renderCount = 0;
      const QueryComponent = () => {
        const { loading, data } = useQuery(GET_TODOS_QUERY);
        const [mutate] = useMutation(CREATE_TODO_MUTATION);
        switch (++renderCount) {
          case 1:
            expect(loading).toBe(true);
            expect(data).toBeUndefined();
            break;
          case 2:
            expect(loading).toBe(false);
            expect(data).toEqual(mocks[0].result.data);
            setTimeout(() => {
              act(() => {
                mutate({
                  variables,
                  refetchQueries: [GET_TODOS_QUERY],
                });
              });
            });
            break;
          case 3:
          case 4:
            expect(loading).toBe(false);
            expect(data).toEqual(mocks[0].result.data);
            break;
          case 5:
            expect(loading).toBe(false);
            expect(data).toEqual(mocks[2].result.data);
            break;
          default:
            reject("too many renders");
        }

        return null;
      };

      render(
        <ApolloProvider client={client}>
          <QueryComponent />
        </ApolloProvider>
      );

      return wait(() => expect(renderCount).toBe(5))
        .then(() => {
          expect(client.readQuery({ query: GET_TODOS_QUERY}))
            .toEqual(mocks[2].result.data);
        })
        .then(resolve, reject);
    });

    itAsync('refetchQueries should update cache after unmount', async (resolve, reject) => {
      const variables = { description: 'Get milk!' };
      const mocks = [
        {
          request: {
            query: GET_TODOS_QUERY,
          },
          result: { data: GET_TODOS_RESULT_1 },
        },
        {
          request: {
            query: CREATE_TODO_MUTATION,
            variables,
          },
          result: {
            data: CREATE_TODO_RESULT,
          },
        },
        {
          request: {
            query: GET_TODOS_QUERY,
          },
          result: { data: GET_TODOS_RESULT_2 },
        },
      ];

      const link = mockSingleLink(...mocks).setOnError(reject);
      const client = new ApolloClient({
        link,
        cache: new InMemoryCache(),
      });

      let unmount: Function;
      let renderCount = 0;
      const QueryComponent = () => {
        const { loading, data } = useQuery(GET_TODOS_QUERY);
        const [mutate] = useMutation(CREATE_TODO_MUTATION);
        switch (++renderCount) {
          case 1:
            expect(loading).toBe(true);
            expect(data).toBeUndefined();
            break;
          case 2:
            expect(loading).toBe(false);
            expect(data).toEqual(mocks[0].result.data);
            setTimeout(() => {
              act(() => {
                mutate({
                  variables,
                  refetchQueries: ['getTodos'],
                  update() {
                    unmount();
                  },
                });
              });
            });
            break;
          case 3:
            expect(loading).toBe(false);
            expect(data).toEqual(mocks[0].result.data);
            break;
          default:
            reject("too many renders");
        }

        return null;
      };

      ({unmount} = render(
        <ApolloProvider client={client}>
          <QueryComponent />
        </ApolloProvider>
      ));

      return wait(() => expect(renderCount).toBe(3))
        .then(() => {
          expect(client.readQuery({ query: GET_TODOS_QUERY}))
            .toEqual(mocks[2].result.data);
        })
        .then(resolve, reject);
    });
  });
});
