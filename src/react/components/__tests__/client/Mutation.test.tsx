import React, { useState } from 'react';
import gql from 'graphql-tag';
import { ExecutionResult, GraphQLError } from 'graphql';
import { render, cleanup, fireEvent, wait, act } from '@testing-library/react';

import { ApolloClient } from '../../../../core';
import { ApolloError } from '../../../../errors';
import { DataProxy, InMemoryCache as Cache } from '../../../../cache';
import { ApolloProvider } from '../../../context';
import { stripSymbols, MockedProvider, MockLink, mockSingleLink } from '../../../../testing';
import { Query } from '../../Query';
import { Mutation } from '../../Mutation';

const mutation = gql`
  mutation createTodo($text: String!) {
    createTodo {
      id
      text
      completed
      __typename
    }
    __typename
  }
`;

type Data = {
  createTodo: {
    __typename: string;
    id: string;
    text: string;
    completed: boolean;
  };
  __typename: string;
};

const data: Data = {
  createTodo: {
    __typename: 'Todo',
    id: '99',
    text: 'This one was created with a mutation.',
    completed: true
  },
  __typename: 'Mutation'
};

const data2: Data = {
  createTodo: {
    __typename: 'Todo',
    id: '100',
    text: 'This one was created with a mutation.',
    completed: true
  },
  __typename: 'Mutation'
};

const mocks = [
  {
    request: { query: mutation },
    result: { data }
  },
  {
    request: { query: mutation },
    result: { data: data2 }
  }
];

const cache = new Cache({ addTypename: false });

describe('General Mutation testing', () => {
  afterEach(cleanup);

  it('pick prop client over context client', async () => {
    const mock = (text: string) => [
      {
        request: { query: mutation },
        result: {
          data: {
            createTodo: {
              __typename: 'Todo',
              id: '99',
              text,
              completed: true
            },
            __typename: 'Mutation'
          }
        }
      },
      {
        request: { query: mutation },
        result: {
          data: {
            createTodo: {
              __typename: 'Todo',
              id: '100',
              text,
              completed: true
            },
            __typename: 'Mutation'
          }
        }
      }
    ];

    const mocksProps = mock('This is the result of the prop client mutation.');
    const mocksContext = mock(
      'This is the result of the context client mutation.'
    );

    function mockClient(m: any) {
      return new ApolloClient({
        link: new MockLink(m, false),
        cache: new Cache({ addTypename: false })
      });
    }

    const contextClient = mockClient(mocksContext);
    const propsClient = mockClient(mocksProps);
    const spy = jest.fn();

    const Component = (props: any) => {
      return (
        <ApolloProvider client={contextClient}>
          <Mutation client={props.propsClient} mutation={mutation}>
            {(createTodo: any) => (
              <button onClick={() => createTodo().then(spy)}>Create</button>
            )}
          </Mutation>
        </ApolloProvider>
      );
    };

    const { getByText, rerender } = render(<Component />);
    const button = getByText('Create');

    // context client mutation
    fireEvent.click(button);

    // props client mutation
    rerender(<Component propsClient={propsClient} />);
    fireEvent.click(button);

    // context client mutation
    rerender(<Component propsClient={undefined} />);
    fireEvent.click(button);

    // props client mutation
    rerender(<Component propsClient={propsClient} />);
    fireEvent.click(button);

    await wait();

    expect(spy).toHaveBeenCalledTimes(4);
    expect(spy).toHaveBeenCalledWith(mocksContext[0].result);
    expect(spy).toHaveBeenCalledWith(mocksProps[0].result);
    expect(spy).toHaveBeenCalledWith(mocksContext[1].result);
    expect(spy).toHaveBeenCalledWith(mocksProps[1].result);
  });

  it('performs a mutation', async () => {
    let count = 0;
    const Component = () => (
      <Mutation mutation={mutation}>
        {(createTodo: any, result: any) => {
          if (count === 0) {
            expect(result.loading).toEqual(false);
            expect(result.called).toEqual(false);
            createTodo();
          } else if (count === 1) {
            expect(result.called).toEqual(true);
            expect(result.loading).toEqual(true);
          } else if (count === 2) {
            expect(result.called).toEqual(true);
            expect(result.loading).toEqual(false);
            expect(result.data).toEqual(data);
          }
          count++;
          return <div />;
        }}
      </Mutation>
    );

    render(
      <MockedProvider mocks={mocks}>
        <Component />
      </MockedProvider>
    );

    await wait();
  });

  it('can bind only the mutation and not rerender by props', done => {
    let count = 0;
    const Component = () => (
      <Mutation mutation={mutation} ignoreResults>
        {(createTodo: any, result: any) => {
          if (count === 0) {
            expect(result.loading).toEqual(false);
            expect(result.called).toEqual(false);
            setTimeout(() => {
              createTodo().then((r: any) => {
                expect(r!.data).toEqual(data);
                done();
              });
            });
          } else if (count === 1) {
            done.fail('rerender happened with ignoreResults turned on');
          }
          count++;
          return <div />;
        }}
      </Mutation>
    );

    render(
      <MockedProvider mocks={mocks}>
        <Component />
      </MockedProvider>
    );
  });

  it('returns a resolved promise when calling the mutation function', async () => {
    let called = false;
    const Component = () => (
      <Mutation mutation={mutation}>
        {(createTodo: any) => {
          if (!called) {
            createTodo().then((result: any) => {
              expect(result!.data).toEqual(data);
            });
          }
          called = true;

          return null;
        }}
      </Mutation>
    );

    render(
      <MockedProvider mocks={mocks}>
        <Component />
      </MockedProvider>
    );

    await wait();
  });

  it('returns rejected promise when calling the mutation function', async () => {
    let called = false;
    const Component = () => (
      <Mutation mutation={mutation}>
        {(createTodo: any) => {
          if (!called) {
            createTodo().catch((error: any) => {
              expect(error).toEqual(new Error('Error 1'));
            });
          }

          called = true;
          return null;
        }}
      </Mutation>
    );

    const mocksWithErrors = [
      {
        request: { query: mutation },
        error: new Error('Error 1')
      }
    ];

    render(
      <MockedProvider mocks={mocksWithErrors}>
        <Component />
      </MockedProvider>
    );

    await wait();
  });

  it('only shows result for the latest mutation that is in flight', async () => {
    let count = 0;

    const onCompleted = (dataMutation: Data) => {
      if (count === 1) {
        expect(dataMutation).toEqual(data);
      } else if (count === 3) {
        expect(dataMutation).toEqual(data2);
      }
    };
    const Component = () => (
      <Mutation mutation={mutation} onCompleted={onCompleted}>
        {(createTodo: any, result: any) => {
          if (count === 0) {
            expect(result.called).toEqual(false);
            expect(result.loading).toEqual(false);
            createTodo();
            createTodo();
          } else if (count === 1) {
            expect(result.called).toEqual(true);
            expect(result.loading).toEqual(true);
          } else if (count === 2) {
            expect(result.loading).toEqual(false);
            expect(result.called).toEqual(true);
            expect(result.data).toEqual(data2);
          }
          count++;
          return <div />;
        }}
      </Mutation>
    );

    render(
      <MockedProvider mocks={mocks}>
        <Component />
      </MockedProvider>
    );

    await wait();
  });

  it('only shows the error for the latest mutation in flight', async () => {
    let count = 0;

    const onError = (error: Error) => {
      if (count === 1) {
        expect(error).toEqual(new Error('Error 1'));
      } else if (count === 3) {
        expect(error).toEqual(new Error('Error 2'));
      }
    };
    const Component = () => (
      <Mutation mutation={mutation} onError={onError}>
        {(createTodo: any, result: any) => {
          if (count === 0) {
            expect(result.called).toEqual(false);
            expect(result.loading).toEqual(false);
            createTodo();
            createTodo();
          } else if (count === 1) {
            expect(result.loading).toEqual(true);
            expect(result.called).toEqual(true);
          } else if (count === 2) {
            expect(result.loading).toEqual(false);
            expect(result.data).toEqual(undefined);
            expect(result.called).toEqual(true);
            expect(result.error).toEqual(new Error('Error 2'));
          }
          count++;
          return <div />;
        }}
      </Mutation>
    );

    const mocksWithErrors = [
      {
        request: { query: mutation },
        error: new Error('Error 2')
      },
      {
        request: { query: mutation },
        error: new Error('Error 2')
      }
    ];

    render(
      <MockedProvider mocks={mocksWithErrors}>
        <Component />
      </MockedProvider>
    );

    await wait();
  });

  it('calls the onCompleted prop as soon as the mutation is complete', async () => {
    let onCompletedCalled = false;

    class Component extends React.Component {
      state = {
        mutationDone: false
      };

      onCompleted = (mutationData: Data) => {
        expect(mutationData).toEqual(data);
        onCompletedCalled = true;
        this.setState({
          mutationDone: true
        });
      };

      render() {
        return (
          <Mutation mutation={mutation} onCompleted={this.onCompleted}>
            {(createTodo: any, result: any) => {
              if (!result.called) {
                expect(this.state.mutationDone).toBe(false);
                createTodo();
              }
              if (onCompletedCalled) {
                expect(this.state.mutationDone).toBe(true);
              }
              return null;
            }}
          </Mutation>
        );
      }
    }

    render(
      <MockedProvider mocks={mocks}>
        <Component />
      </MockedProvider>
    );

    await wait();
  });

  it('renders result of the children render prop', () => {
    const Component = () => (
      <Mutation mutation={mutation}>{() => <div>result</div>}</Mutation>
    );

    const { getByText } = render(
      <MockedProvider mocks={mocks}>
        <Component />
      </MockedProvider>
    );
    expect(getByText('result')).toBeTruthy();
  });

  it('renders an error state', async () => {
    let count = 0;
    const Component = () => (
      <Mutation mutation={mutation}>
        {(createTodo: any, result: any) => {
          if (count === 0) {
            createTodo().catch((err: any) => {
              expect(err).toEqual(new Error('error occurred'));
            });
          } else if (count === 1) {
            expect(result.loading).toBeTruthy();
          } else if (count === 2) {
            expect(result.error).toEqual(
              new Error('error occurred')
            );
          }
          count++;
          return <div />;
        }}
      </Mutation>
    );

    const mockError = [
      {
        request: { query: mutation },
        error: new Error('error occurred')
      }
    ];

    render(
      <MockedProvider mocks={mockError}>
        <Component />
      </MockedProvider>
    );

    await wait();
  });

  it('renders an error state and throws when encountering graphql errors', async () => {
    let count = 0;

    const expectedError = new ApolloError({
      graphQLErrors: [new GraphQLError('error occurred')]
    });

    const Component = () => (
      <Mutation mutation={mutation}>
        {(createTodo: any, result: any) => {
          if (count === 0) {
            createTodo()
              .then(() => {
                throw new Error('Did not expect a result');
              })
              .catch((e: any) => {
                expect(e).toEqual(expectedError);
              });
          } else if (count === 1) {
            expect(result.loading).toBeTruthy();
          } else if (count === 2) {
            expect(result.error).toEqual(expectedError);
          }
          count++;
          return <div />;
        }}
      </Mutation>
    );

    const mockError = [
      {
        request: { query: mutation },
        result: {
          errors: [new GraphQLError('error occurred')]
        }
      }
    ];

    render(
      <MockedProvider mocks={mockError}>
        <Component />
      </MockedProvider>
    );

    await wait();
  });

  it('renders an error state and does not throw when encountering graphql errors when errorPolicy=all', async () => {
    let count = 0;
    const Component = () => (
      <Mutation mutation={mutation}>
        {(createTodo: any, result: any) => {
          if (count === 0) {
            createTodo()
              .then((fetchResult: any) => {
                if (fetchResult && fetchResult.errors) {
                  expect(fetchResult.errors.length).toEqual(1);
                  expect(fetchResult.errors[0]).toEqual(
                    new GraphQLError('error occurred')
                  );
                } else {
                  throw new Error(
                    `Expected an object with array of errors but got ${fetchResult}`
                  );
                }
              })
              .catch((e: any) => {
                throw e;
              });
          } else if (count === 1) {
            expect(result.loading).toBeTruthy();
          } else if (count === 2) {
            expect(result.error).toEqual(
              new ApolloError({
                graphQLErrors: [new GraphQLError('error occurred')]
              })
            );
          }
          count++;
          return <div />;
        }}
      </Mutation>
    );

    const mockError = [
      {
        request: { query: mutation },
        result: {
          errors: [new GraphQLError('error occurred')]
        }
      }
    ];

    render(
      <MockedProvider
        defaultOptions={{ mutate: { errorPolicy: 'all' } }}
        mocks={mockError}
      >
        <Component />
      </MockedProvider>
    );

    await wait();
  });

  it('renders an error state and throws when encountering network errors when errorPolicy=all', async () => {
    let count = 0;
    const expectedError = new ApolloError({
      networkError: new Error('network error')
    });
    const Component = () => (
      <Mutation mutation={mutation}>
        {(createTodo: any, result: any) => {
          if (count === 0) {
            createTodo()
              .then(() => {
                throw new Error('Did not expect a result');
              })
              .catch((e: any) => {
                expect(e).toEqual(expectedError);
              });
          } else if (count === 1) {
            expect(result.loading).toBeTruthy();
          } else if (count === 2) {
            expect(result.error).toEqual(expectedError);
          }
          count++;
          return <div />;
        }}
      </Mutation>
    );

    const mockError = [
      {
        request: { query: mutation },
        error: new Error('network error')
      }
    ];

    render(
      <MockedProvider
        defaultOptions={{ mutate: { errorPolicy: 'all' } }}
        mocks={mockError}
      >
        <Component />
      </MockedProvider>
    );

    await wait();
  });

  it('calls the onError prop if the mutation encounters an error', async () => {
    let onRenderCalled = false;

    class Component extends React.Component {
      state = {
        mutationError: false
      };

      onError = (error: Error) => {
        expect(error.message).toMatch('error occurred');
        onRenderCalled = true;
        this.setState({ mutationError: true });
      };

      render() {
        const { mutationError } = this.state;

        return (
          <Mutation mutation={mutation} onError={this.onError}>
            {(createTodo: any, result: any) => {
              if (!result.called) {
                expect(mutationError).toBe(false);
                createTodo();
              }
              if (onRenderCalled) {
                expect(mutationError).toBe(true);
              }
              return null;
            }}
          </Mutation>
        );
      }
    }

    const mockError = [
      {
        request: { query: mutation },
        error: new Error('error occurred')
      }
    ];

    render(
      <MockedProvider mocks={mockError}>
        <Component />
      </MockedProvider>
    );

    await wait();
  });

  it('performs a mutation with variables prop', async () => {
    const variables = {
      text: 'play tennis'
    };

    let count = 0;
    const Component = () => (
      <Mutation mutation={mutation} variables={variables}>
        {(createTodo: any, result: any) => {
          if (count === 0) {
            createTodo();
          } else if (count === 1) {
            expect(result.loading).toEqual(true);
            expect(result.called).toEqual(true);
          } else if (count === 2) {
            expect(result.loading).toEqual(false);
            expect(result.called).toEqual(true);
            expect(result.data).toEqual(data);
          }
          count++;
          return <div />;
        }}
      </Mutation>
    );

    const mocks1 = [
      {
        request: { query: mutation, variables },
        result: { data }
      }
    ];

    render(
      <MockedProvider mocks={mocks1}>
        <Component />
      </MockedProvider>
    );

    await wait();
  });

  it('allows passing a variable to the mutate function', async () => {
    const variables = {
      text: 'play tennis'
    };

    let count = 0;
    const Component = () => (
      <Mutation mutation={mutation}>
        {(createTodo: any, result: any) => {
          if (count === 0) {
            createTodo({ variables });
          } else if (count === 1) {
            expect(result.loading).toEqual(true);
            expect(result.called).toEqual(true);
          } else if (count === 2) {
            expect(result.loading).toEqual(false);
            expect(result.called).toEqual(true);
            expect(result.data).toEqual(data);
          }
          count++;
          return <div />;
        }}
      </Mutation>
    );

    const mocks1 = [
      {
        request: { query: mutation, variables },
        result: { data }
      }
    ];

    render(
      <MockedProvider mocks={mocks1}>
        <Component />
      </MockedProvider>
    );

    await wait();
  });

  it('allows an optimistic response prop', async () => {
    const link = mockSingleLink(...mocks);
    const client = new ApolloClient({
      link,
      cache
    });

    const optimisticResponse = {
      createTodo: {
        id: '99',
        text: 'This is an optimistic response',
        completed: false,
        __typename: 'Todo'
      },
      __typename: 'Mutation'
    };

    let count = 0;
    const Component = () => (
      <Mutation mutation={mutation} optimisticResponse={optimisticResponse}>
        {(createTodo: any, result: any) => {
          if (count === 0) {
            createTodo();
            const dataInStore = client.cache.extract(true);
            expect(dataInStore['Todo:99']).toEqual(
              optimisticResponse.createTodo
            );
          } else if (count === 1) {
            expect(result.loading).toEqual(true);
            expect(result.called).toEqual(true);
          } else if (count === 2) {
            expect(result.loading).toEqual(false);
            expect(result.called).toEqual(true);
            expect(result.data).toEqual(data);
          }
          count++;
          return <div />;
        }}
      </Mutation>
    );

    render(
      <ApolloProvider client={client}>
        <Component />
      </ApolloProvider>
    );

    await wait();
  });

  it('allows passing an optimistic response to the mutate function', async () => {
    const link = mockSingleLink(...mocks);
    const client = new ApolloClient({
      link,
      cache
    });

    const optimisticResponse = {
      createTodo: {
        id: '99',
        text: 'This is an optimistic response',
        completed: false,
        __typename: 'Todo'
      },
      __typename: 'Mutation'
    };

    let count = 0;
    const Component = () => (
      <Mutation mutation={mutation}>
        {(createTodo: any, result: any) => {
          if (count === 0) {
            createTodo({ optimisticResponse });
            const dataInStore = client.cache.extract(true);
            expect(dataInStore['Todo:99']).toEqual(
              optimisticResponse.createTodo
            );
          } else if (count === 2) {
            expect(result.loading).toEqual(false);
            expect(result.called).toEqual(true);
            expect(result.data).toEqual(data);
          }
          count++;
          return <div />;
        }}
      </Mutation>
    );

    render(
      <ApolloProvider client={client}>
        <Component />
      </ApolloProvider>
    );

    await wait();
  });

  it('allows a refetchQueries prop', async () => {
    const query = gql`
      query getTodo {
        todo {
          id
          text
          completed
          __typename
        }
        __typename
      }
    `;

    const queryData = {
      todo: {
        id: '1',
        text: 'todo from query',
        completed: false,
        __typename: 'Todo'
      },
      __typename: 'Query'
    };

    const mocksWithQuery = [
      ...mocks,
      {
        request: { query },
        result: { data: queryData }
      },
      {
        request: { query },
        result: { data: queryData }
      },
    ];

    const refetchQueries = [
      {
        query
      }
    ];

    let renderCount = 0;
    const Component = () => (
      <Mutation mutation={mutation} refetchQueries={refetchQueries}>
        {(createTodo: any, resultMutation: any) => (
          <Query query={query}>
            {(resultQuery: any) => {
              ++renderCount;
              if (renderCount === 1) {
                setTimeout(() => createTodo(), 10);
              } else if (renderCount === 2) {
                expect(resultMutation.loading).toBe(false);
                expect(resultQuery.loading).toBe(false);
              } else if (renderCount === 3) {
                expect(resultMutation.loading).toBe(true);
                expect(stripSymbols(resultQuery.data)).toEqual(queryData);
              } else if (renderCount === 4) {
                expect(resultMutation.loading).toBe(false);
              }
              return null;
            }}
          </Query>
        )}
      </Mutation>
    );

    render(
      <MockedProvider mocks={mocksWithQuery}>
        <Component />
      </MockedProvider>
    );

    return wait(() => {
      expect(renderCount).toBe(4);
    });
  });

  it('allows a refetchQueries prop as string and variables have updated', async () => {
    const query = gql`
      query people($first: Int) {
        allPeople(first: $first) {
          people {
            name
          }
        }
      }
    `;

    const peopleData1 = {
      allPeople: {
        people: [{ name: 'Luke Skywalker', __typename: 'Person' }],
        __typename: 'People'
      }
    };
    const peopleData2 = {
      allPeople: {
        people: [{ name: 'Han Solo', __typename: 'Person' }],
        __typename: 'People'
      }
    };
    const peopleData3 = {
      allPeople: {
        people: [{ name: 'Lord Vader', __typename: 'Person' }],
        __typename: 'People'
      }
    };
    const peopleMocks = [
      ...mocks,
      {
        request: { query, variables: { first: 1 } },
        result: { data: peopleData1 }
      },
      {
        request: { query, variables: { first: 2 } },
        result: { data: peopleData2 }
      },
      {
        request: { query, variables: { first: 2 } },
        result: { data: peopleData3 }
      }
    ];

    const refetchQueries = ['people'];

    let count = 0;

    const Component: React.FC<any> = props => {
      const [variables, setVariables] = useState(props.variables);
      return (
        <Mutation mutation={mutation} refetchQueries={refetchQueries}>
          {(createTodo: any, resultMutation: any) => (
            <Query query={query} variables={variables}>
              {(resultQuery: any) => {
                if (count === 0) {
                  // "first: 1" loading
                  expect(resultQuery.loading).toBe(true);
                } else if (count === 1) {
                  // "first: 1" loaded
                  expect(resultQuery.loading).toBe(false);
                  setTimeout(() => setVariables({ first: 2 }));
                } else if (count === 2) {
                  // "first: 2" loading
                  expect(resultQuery.loading).toBe(true);
                } else if (count === 3) {
                  // "first: 2" loaded
                  expect(resultQuery.loading).toBe(false);
                  setTimeout(() => createTodo());
                } else if (count === 4) {
                  // mutation loading
                  expect(resultMutation.loading).toBe(true);
                } else if (count === 5) {
                  // mutation loaded
                  expect(resultMutation.loading).toBe(false);
                } else if (count === 6) {
                  // query refetched
                  expect(resultQuery.loading).toBe(false);
                  expect(resultMutation.loading).toBe(false);
                  expect(stripSymbols(resultQuery.data)).toEqual(peopleData3);
                }
                count++;
                return null;
              }}
            </Query>
          )}
        </Mutation>
      );
    };

    render(
      <MockedProvider mocks={peopleMocks}>
        <Component variables={{ first: 1 }} />
      </MockedProvider>
    );

    await wait(() => {
      expect(count).toBe(7);
    });
  });

  it('allows refetchQueries to be passed to the mutate function', async () => {
    const query = gql`
      query getTodo {
        todo {
          id
          text
          completed
          __typename
        }
        __typename
      }
    `;

    const queryData = {
      todo: {
        id: '1',
        text: 'todo from query',
        completed: false,
        __typename: 'Todo'
      },
      __typename: 'Query'
    };

    const mocksWithQuery = [
      ...mocks,
      {
        request: { query },
        result: { data: queryData }
      },
      {
        request: { query },
        result: { data: queryData }
      },
    ];

    const refetchQueries = [
      {
        query
      }
    ];

    let count = 0;
    const Component = () => (
      <Mutation mutation={mutation}>
        {(createTodo: any, resultMutation: any) => (
          <Query query={query}>
            {(resultQuery: any) => {
              if (count === 0) {
                setTimeout(() => createTodo({ refetchQueries }), 10);
              } else if (count === 1) {
                expect(resultMutation.loading).toBe(false);
                expect(resultQuery.loading).toBe(false);
              } else if (count === 2) {
                expect(resultMutation.loading).toBe(true);
                expect(stripSymbols(resultQuery.data)).toEqual(queryData);
              } else if (count === 3) {
                expect(resultMutation.loading).toBe(false);
              }
              count++;
              return null;
            }}
          </Query>
        )}
      </Mutation>
    );

    render(
      <MockedProvider mocks={mocksWithQuery}>
        <Component />
      </MockedProvider>
    );

    await wait(() => {
      expect(count).toBe(4);
    });
  });

  it('has an update prop for updating the store after the mutation', async () => {
    const update = (_proxy: DataProxy, response: ExecutionResult) => {
      expect(response.data).toEqual(data);
    };

    let count = 0;
    const Component = () => (
      <Mutation mutation={mutation} update={update}>
        {(createTodo: any) => {
          if (count === 0) {
            createTodo().then((response: any) => {
              expect(response!.data).toEqual(data);
            });
          }
          count++;
          return null;
        }}
      </Mutation>
    );

    render(
      <MockedProvider mocks={mocks}>
        <Component />
      </MockedProvider>
    );

    await wait();
  });

  it('allows update to be passed to the mutate function', async () => {
    const update = (_proxy: DataProxy, response: ExecutionResult) => {
      expect(response.data).toEqual(data);
    };

    let count = 0;
    const Component = () => (
      <Mutation mutation={mutation}>
        {(createTodo: any) => {
          if (count === 0) {
            createTodo({ update }).then((response: any) => {
              expect(response!.data).toEqual(data);
            });
          }
          count++;
          return null;
        }}
      </Mutation>
    );

    render(
      <MockedProvider mocks={mocks}>
        <Component />
      </MockedProvider>
    );

    await wait();
  });

  it('allows for overriding the options passed in the props by passing them in the mutate function', async () => {
    const variablesProp = {
      text: 'play tennis'
    };

    const variablesMutateFn = {
      text: 'go swimming'
    };

    let count = 0;
    const Component = () => (
      <Mutation mutation={mutation} variables={variablesProp}>
        {(createTodo: any, result: any) => {
          if (count === 0) {
            createTodo({ variables: variablesMutateFn });
          } else if (count === 2) {
            expect(result.loading).toEqual(false);
            expect(result.called).toEqual(true);
            expect(result.data).toEqual(data2);
          }
          count++;
          return <div />;
        }}
      </Mutation>
    );

    const mocks1 = [
      {
        request: { query: mutation, variables: variablesProp },
        result: { data }
      },
      {
        request: { query: mutation, variables: variablesMutateFn },
        result: { data: data2 }
      }
    ];

    render(
      <MockedProvider mocks={mocks1}>
        <Component />
      </MockedProvider>
    );

    await wait(() => {
      expect(count).toBe(3);
    });
  });

  it('updates if the client changes', async () => {
    const link1 = mockSingleLink({
      request: { query: mutation },
      result: { data }
    });
    const client1 = new ApolloClient({
      link: link1,
      cache: new Cache({ addTypename: false })
    });

    const data3 = {
      createTodo: {
        __typename: 'Todo',
        id: '100',
        text: 'After updating client.',
        completed: false
      },
      __typename: 'Mutation'
    };

    const link2 = mockSingleLink({
      request: { query: mutation },
      result: { data: data3 }
    });

    const client2 = new ApolloClient({
      link: link2,
      cache: new Cache({ addTypename: false })
    });

    let count = 0;
    class Component extends React.Component {
      state = {
        client: client1
      };

      render() {
        return (
          <ApolloProvider client={this.state.client}>
            <Mutation mutation={mutation}>
              {(createTodo: any, result: any) => {
                if (count === 0) {
                  expect(result.called).toEqual(false);
                  expect(result.loading).toEqual(false);
                  createTodo();
                } else if (count === 2 && result) {
                  expect(result.data).toEqual(data);
                  setTimeout(() => {
                    this.setState({
                      client: client2
                    });
                  });
                } else if (count === 3) {
                  expect(result.loading).toEqual(false);
                  createTodo();
                } else if (count === 5) {
                  expect(result.data).toEqual(data3);
                }
                count++;
                return null;
              }}
            </Mutation>
          </ApolloProvider>
        );
      }
    }

    render(<Component />);

    await wait(() => {
      expect(count).toBe(6);
    });
  });

  it('uses client from props instead of one provided by context', () => {
    const link1 = mockSingleLink({
      request: { query: mutation },
      result: { data }
    });
    const client1 = new ApolloClient({
      link: link1,
      cache: new Cache({ addTypename: false })
    });

    const link2 = mockSingleLink({
      request: { query: mutation },
      result: { data: data2 }
    });
    const client2 = new ApolloClient({
      link: link2,
      cache: new Cache({ addTypename: false })
    });

    let count = 0;

    render(
      <ApolloProvider client={client1}>
        <Mutation client={client2} mutation={mutation}>
          {(createTodo: any, result: any) => {
            if (!result.called) {
              act(() => {
                createTodo();
              });
            }

            if (count === 2) {
              expect(result.loading).toEqual(false);
              expect(result.called).toEqual(true);
              expect(result.data).toEqual(data2);
            }

            count++;
            return <div />;
          }}
        </Mutation>
      </ApolloProvider>
    );

    return wait(() => {
      expect(count).toBe(3);
    });
  });

  it('errors if a query is passed instead of a mutation', () => {
    const query = gql`
      query todos {
        todos {
          id
        }
      }
    `;

    // Prevent error from being logged in console of test.
    const errorLogger = console.error;
    console.error = () => {};

    expect(() => {
      render(
        <MockedProvider>
          <Mutation mutation={query}>{() => null}</Mutation>
        </MockedProvider>
      );
    }).toThrowError(
      'Running a Mutation requires a graphql Mutation, but a Query was used ' +
        'instead.'
    );

    console.log = errorLogger;
  });

  it('errors when changing from mutation to a query', done => {
    const query = gql`
      query todos {
        todos {
          id
        }
      }
    `;

    class Component extends React.Component {
      state = {
        query: mutation
      };

      componentDidCatch(e: Error) {
        expect(e).toEqual(
          new Error(
            'Running a Mutation requires a graphql Mutation, but a Query ' +
              'was used instead.'
          )
        );
        done();
      }
      render() {
        return (
          <Mutation mutation={this.state.query}>
            {() => {
              setTimeout(() => {
                this.setState({
                  query
                });
              });
              return null;
            }}
          </Mutation>
        );
      }
    }

    // Prevent error from being logged in console of test.
    const errorLogger = console.error;
    console.error = () => {};

    render(
      <MockedProvider>
        <Component />
      </MockedProvider>
    );

    console.log = errorLogger;
  });

  it('errors if a subscription is passed instead of a mutation', () => {
    const subscription = gql`
      subscription todos {
        todos {
          id
        }
      }
    `;

    // Prevent error from being logged in console of test.
    const errorLogger = console.error;
    console.error = () => {};

    expect(() => {
      render(
        <MockedProvider>
          <Mutation mutation={subscription}>{() => null}</Mutation>
        </MockedProvider>
      );
    }).toThrowError(
      'Running a Mutation requires a graphql Mutation, but a Subscription ' +
        'was used instead.'
    );

    console.log = errorLogger;
  });

  it('errors when changing from mutation to a subscription', done => {
    const subscription = gql`
      subscription todos {
        todos {
          id
        }
      }
    `;

    class Component extends React.Component {
      state = {
        query: mutation
      };

      componentDidCatch(e: Error) {
        expect(e).toEqual(
          new Error(
            'Running a Mutation requires a graphql Mutation, but a ' +
              'Subscription was used instead.'
          )
        );
        done();
      }

      render() {
        return (
          <Mutation mutation={this.state.query}>
            {() => {
              setTimeout(() => {
                this.setState({
                  query: subscription
                });
              });
              return null;
            }}
          </Mutation>
        );
      }
    }

    // Prevent error from being logged in console of test.
    const errorLogger = console.error;
    console.error = () => {};

    render(
      <MockedProvider>
        <Component />
      </MockedProvider>
    );

    console.log = errorLogger;
  });

  describe('after it has been unmounted', () => {
    it('calls the onCompleted prop after the mutation is complete', done => {
      let success = false;
      const onCompletedFn = jest.fn();
      const checker = () => {
        setTimeout(() => {
          success = true;
          expect(onCompletedFn).toHaveBeenCalledWith(data);
          done();
        }, 100);
      };

      class Component extends React.Component {
        state = {
          called: false
        };

        render() {
          const { called } = this.state;
          if (called === true) {
            return null;
          } else {
            return (
              <Mutation mutation={mutation} onCompleted={onCompletedFn}>
                {(createTodo: any) => {
                  setTimeout(() => {
                    createTodo();
                    this.setState({ called: true }, checker);
                  });
                  return null;
                }}
              </Mutation>
            );
          }
        }
      }

      render(
        <MockedProvider mocks={mocks}>
          <Component />
        </MockedProvider>
      );

      setTimeout(() => {
        if (!success) done.fail('timeout passed');
      }, 500);
    });
  });

  it('calls the onError prop if the mutation encounters an error', async () => {
    let onErrorCalled = false;
    function onError(error: ApolloError) {
      expect(error.message).toEqual('error occurred');
      onErrorCalled = true;
    }

    function Component() {
      return (
        <Mutation mutation={mutation} onError={onError}>
          {(createTodo: any, { called }: { called: boolean }) => {
            if (!called) {
              createTodo();
            }
            return null;
          }}
        </Mutation>
      );
    }

    const mockError = [
      {
        request: { query: mutation },
        error: new Error('error occurred')
      }
    ];

    render(
      <MockedProvider mocks={mockError}>
        <Component />
      </MockedProvider>
    );

    await wait(() => {
      expect(onErrorCalled).toBeTruthy();
    });
  });
});
