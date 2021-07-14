import React, { useEffect } from 'react';
import { DocumentNode, GraphQLError } from 'graphql';
import gql from 'graphql-tag';
import { render, cleanup, wait } from '@testing-library/react';

import { ApolloClient } from '../../../core';
import { InMemoryCache } from '../../../cache';
import { itAsync, MockedProvider, mockSingleLink } from '../../../testing';
import { ApolloProvider } from '../../context';
import { useMutation } from '../useMutation';

describe('useMutation Hook', () => {
  interface Todo {
    id: number;
    description: string;
    priority: string;
  }

  const CREATE_TODO_MUTATION: DocumentNode = gql`
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
  });
});
