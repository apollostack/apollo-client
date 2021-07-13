import React from 'react';
import { render, wait } from '@testing-library/react';
import gql from 'graphql-tag';
import { DocumentNode } from 'graphql';

import { ApolloCache, ApolloClient, MutationUpdaterFunction } from '../../../../core';
import { ApolloProvider } from '../../../context';
import { InMemoryCache as Cache } from '../../../../cache';
import { MutationFunction } from '../../../types/types';
import { stripSymbols, mockSingleLink } from '../../../../testing';
import { graphql } from '../../graphql';
import { ChildProps } from '../../types';

describe('graphql(mutation) update queries', () => {
  // This is a long test that keeps track of a lot of stuff. It is testing
  // whether or not the `options.update` reducers will run even when a given
  // container component is unmounted.
  //
  // It does this with the following procedure:
  //
  // 1. Mount a mutation component.
  // 2. Mount a query component.
  // 3. Run the mutation in the mutation component.
  // 4. Check the props in the query component.
  // 5. Unmount the query component.
  // 6. Run the mutation in the mutation component again.
  // 7. Remount the query component.
  // 8. Check the props in the query component to confirm that the mutation
  //    that was run while we were unmounted changed the query component’s
  //    props.
  //
  // There are also a lot more assertions on the way to make sure everything is
  // going as smoothly as planned.
  it('will run `update` for a previously mounted component', async () => {
    const query: DocumentNode = gql`
      query todos {
        todo_list {
          id
          title
          tasks {
            id
            text
            completed
          }
        }
      }
    `;

    interface QueryData {
      todo_list: {
        id: string;
        title: string;
        tasks: { id: string; text: string; completed: boolean }[];
      };
    }

    const mutation: DocumentNode = gql`
      mutation createTodo {
        createTodo {
          id
          text
          completed
        }
      }
    `;

    const mutationData = {
      createTodo: {
        id: '99',
        text: 'This one was created with a mutation.',
        completed: true
      }
    };
    type MutationData = typeof mutationData;

    let todoUpdateQueryCount = 0;
    const update: MutationUpdaterFunction<
      MutationData,
      Record<string, any>,
      Record<string, any>,
      ApolloCache<any>
    > = (proxy, result) => {
      todoUpdateQueryCount++;
      const data = JSON.parse(
        JSON.stringify(
          proxy.readQuery<QueryData>({ query })
        ) // read from cache
      );
      data!.todo_list.tasks.push(result.data!.createTodo); // update value
      proxy.writeQuery({ query, data }); // write to cache
    };

    const expectedData = {
      todo_list: { id: '123', title: 'how to apollo', tasks: [] }
    };

    const link = mockSingleLink(
      {
        request: { query },
        result: { data: expectedData }
      },
      { request: { query: mutation }, result: { data: mutationData } },
      { request: { query: mutation }, result: { data: mutationData } }
    );
    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });

    let mutate: MutationFunction<MutationData>;

    const MyMutation = graphql<{}, MutationData>(mutation, {
      options: () => ({ update })
    })(
      class extends React.Component<ChildProps<{}, MutationData>> {
        componentDidMount() {
          mutate = this.props.mutate!;
        }

        render() {
          return null;
        }
      }
    );

    let queryMountCount = 0;
    let queryUnmountCount = 0;
    let queryRenderCount = 0;

    const MyQuery = graphql<{}, QueryData>(query)(
      class extends React.Component<ChildProps<{}, QueryData>> {
        componentDidMount() {
          queryMountCount++;
        }

        componentWillUnmount() {
          queryUnmountCount++;
        }

        render() {
          switch (queryRenderCount) {
            case 0:
              expect(this.props.data!.loading).toBeTruthy();
              expect(this.props.data!.todo_list).toBeFalsy();
              break;
            case 1:
              expect(this.props.data!.loading).toBeFalsy();
              expect(stripSymbols(this.props.data!.todo_list)).toEqual({
                id: '123',
                title: 'how to apollo',
                tasks: []
              });
              break;
            case 2:
              expect(this.props.data!.loading).toBeFalsy();
              expect(queryMountCount).toBe(1);
              expect(stripSymbols(this.props.data!.todo_list)).toEqual({
                id: '123',
                title: 'how to apollo',
                tasks: [
                  {
                    id: '99',
                    text: 'This one was created with a mutation.',
                    completed: true
                  }
                ]
              });
              break;
            case 3:
              expect(stripSymbols(this.props.data!.todo_list)).toEqual({
                id: '123',
                title: 'how to apollo',
                tasks: [
                  {
                    id: '99',
                    text: 'This one was created with a mutation.',
                    completed: true
                  },
                  {
                    id: '99',
                    text: 'This one was created with a mutation.',
                    completed: true
                  }
                ]
              });
              break;
            default:
          }

          queryRenderCount += 1;
          return null;
        }
      }
    );

    const { unmount: mutationUnmount } = render(
      <ApolloProvider client={client}>
        <MyMutation />
      </ApolloProvider>
    );

    const { unmount: query1Unmount } = render(
      <ApolloProvider client={client}>
        <MyQuery />
      </ApolloProvider>
    );

    setTimeout(() => {
      mutate();

      setTimeout(() => {
        expect(queryUnmountCount).toBe(0);
        query1Unmount();
        expect(queryUnmountCount).toBe(1);

        setTimeout(() => {
          mutate();

          setTimeout(() => {
            const { unmount: query2Unmount } = render(
              <ApolloProvider client={client}>
                <MyQuery />
              </ApolloProvider>
            );

            setTimeout(() => {
              mutationUnmount();
              query2Unmount();

              expect(todoUpdateQueryCount).toBe(2);
              expect(queryMountCount).toBe(2);
              expect(queryUnmountCount).toBe(2);
            }, 5);
          }, 5);
        }, 5);
      }, 6);
    }, 5);

    return wait(() => {
      expect(queryRenderCount).toBe(4);
    });
  });

  it('will run `refetchQueries` for a recycled queries', async () => {
    const mutation: DocumentNode = gql`
      mutation createTodo {
        createTodo {
          id
          text
          completed
        }
      }
    `;

    const mutationData = {
      createTodo: {
        id: '99',
        text: 'This one was created with a mutation.',
        completed: true
      }
    };

    type MutationData = typeof mutationData;

    const query: DocumentNode = gql`
      query todos($id: ID!) {
        todo_list(id: $id) {
          id
          title
          tasks {
            id
            text
            completed
          }
        }
      }
    `;

    interface QueryData {
      todo_list: {
        id: string;
        title: string;
        tasks: { id: string; text: string; completed: boolean }[];
      };
    }

    interface QueryVariables {
      id: string;
    }

    const data = {
      todo_list: { id: '123', title: 'how to apollo', tasks: [] }
    };

    const updatedData = {
      todo_list: {
        id: '123',
        title: 'how to apollo',
        tasks: [mutationData.createTodo]
      }
    };

    const link = mockSingleLink(
      { request: { query, variables: { id: '123' } }, result: { data } },
      { request: { query: mutation }, result: { data: mutationData } },
      {
        request: { query, variables: { id: '123' } },
        result: { data: updatedData }
      }
    );
    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });

    let mutate: MutationFunction<MutationData>;

    const Mutation = graphql<{}, MutationData>(mutation)(
      class extends React.Component<ChildProps<{}, MutationData>> {
        componentDidMount() {
          mutate = this.props.mutate!;
        }

        render() {
          return null;
        }
      }
    );

    let queryMountCount = 0;
    let queryRenderCount = 0;

    const Query = graphql<QueryVariables, QueryData, QueryVariables>(query)(
      class extends React.Component<
        ChildProps<QueryVariables, QueryData, QueryVariables>
      > {
        componentDidMount() {
          queryMountCount++;
        }

        render() {
          switch (queryRenderCount) {
            case 0:
              expect(this.props.data!.loading).toBeTruthy();
              expect(this.props.data!.todo_list).toBeFalsy();
              break;
            case 1:
              expect(this.props.data!.loading).toBeFalsy();
              expect(stripSymbols(this.props.data!.todo_list)).toEqual({
                id: '123',
                title: 'how to apollo',
                tasks: []
              });
              break;
            case 2:
              expect(this.props.data!.loading).toBeFalsy();
              expect(queryMountCount).toBe(1);
              expect(stripSymbols(this.props.data!.todo_list)).toEqual(
                updatedData.todo_list
              );
              break;
            case 3:
              expect(this.props.data!.loading).toBeFalsy();
              expect(stripSymbols(this.props.data!.todo_list)).toEqual(
                updatedData.todo_list
              );
              break;
            default:
          }
          queryRenderCount += 1;
          return null;
        }
      }
    );

    render(
      <ApolloProvider client={client}>
        <Mutation />
      </ApolloProvider>
    );

    render(
      <ApolloProvider client={client}>
        <Query id="123" />
      </ApolloProvider>
    );

    setTimeout(() => {
      mutate({ refetchQueries: [{ query, variables: { id: '123' } }] }).then(
        () => {
          setTimeout(() => {
            render(
              <ApolloProvider client={client}>
                <Query id="123" />
              </ApolloProvider>
            );
          });
        }
      );
    });

    return wait(() => {
      expect(queryRenderCount).toBe(4);
    });
  });
});
