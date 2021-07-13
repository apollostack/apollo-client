import React from 'react';
import { act, render, wait } from '@testing-library/react';
import gql from 'graphql-tag';
import { DocumentNode } from 'graphql';

import { ApolloClient, MutationUpdaterFunction, ApolloCache } from '../../../../core';
import { ApolloProvider } from '../../../context';
import { InMemoryCache as Cache } from '../../../../cache';
import {
  itAsync,
  stripSymbols,
  createMockClient,
  mockSingleLink,
} from '../../../../testing';
import { graphql } from '../../graphql';
import { ChildProps } from '../../types';

describe('graphql(mutation) query integration', () => {
  itAsync('allows for passing optimisticResponse for a mutation', (resolve, reject) => {
    const query: DocumentNode = gql`
      mutation createTodo {
        createTodo {
          id
          text
          completed
          __typename
        }
        __typename
      }
    `;

    const data = {
      __typename: 'Mutation',
      createTodo: {
        __typename: 'Todo',
        id: '99',
        text: 'This one was created with a mutation.',
        completed: true
      }
    };

    type Data = typeof data;

    let mutateFired = false;
    const client = createMockClient(data, query);
    const Container = graphql<{}, Data>(query)(
      class extends React.Component<ChildProps<{}, Data>> {
        componentDidMount() {
          const optimisticResponse = {
            __typename: 'Mutation',
            createTodo: {
              __typename: 'Todo',
              id: '99',
              text: 'Optimistically generated',
              completed: true
            }
          };

          this.props.mutate!({ optimisticResponse }).then(result => {
            expect(stripSymbols(result && result.data)).toEqual(data);
            mutateFired = true;
          });

          const dataInStore = client.cache.extract(true);
          expect(stripSymbols(dataInStore['Todo:99'])).toEqual(
            optimisticResponse.createTodo
          );
        }
        render() {
          return null;
        }
      }
    );

    render(
      <ApolloProvider client={client}>
        <Container />
      </ApolloProvider>
    );

    return wait(() => {
      expect(mutateFired).toBeTruthy();
    }).then(resolve, reject);
  });

  itAsync('allows for updating queries from a mutation', (resolve, reject) => {
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

    const optimisticResponse = {
      createTodo: {
        id: '99',
        text: 'Optimistically generated',
        completed: true
      }
    };
    interface QueryData {
      todo_list: {
        id: string;
        title: string;
        tasks: { id: string; text: string; completed: boolean }[];
      };
    }

    const update: MutationUpdaterFunction<
      MutationData,
      Record<string, any>,
      Record<string, any>,
      ApolloCache<any>
    > = (proxy, result) => {
      const data = JSON.parse(
        JSON.stringify(proxy.readQuery<QueryData>({ query }))
      );
      data.todo_list.tasks.push(result.data!.createTodo); // update value
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
      { request: { query: mutation }, result: { data: mutationData } }
    );
    const cache = new Cache({ addTypename: false });
    const client = new ApolloClient({ link, cache });

    const withQuery = graphql<{}, QueryData>(query);

    type WithQueryChildProps = ChildProps<{}, QueryData>;
    const withMutation = graphql<WithQueryChildProps, MutationData>(mutation, {
      options: () => ({ optimisticResponse, update })
    });

    let renderCount = 0;

    type ContainerProps = ChildProps<WithQueryChildProps, MutationData>;
    class Container extends React.Component<ContainerProps> {
      render() {
        if (!this.props.data || !this.props.data.todo_list) return null;
        if (!this.props.data.todo_list.tasks.length) {
          act(() => {
            this.props.mutate!().then(result => {
              expect(stripSymbols(result && result.data)).toEqual(mutationData);
            });
          });
          return null;
        }

        switch (++renderCount) {
          case 1:
            expect(stripSymbols(this.props.data.todo_list.tasks)).toEqual([
              optimisticResponse.createTodo
            ]);
            break;
          case 2:
            expect(stripSymbols(this.props.data.todo_list.tasks)).toEqual([
              mutationData.createTodo
            ]);
            break;
          default:
            reject(`too many renders (${renderCount})`);
        }

        return null;
      }
    }

    const ContainerWithData = withQuery(withMutation(Container));

    render(
      <ApolloProvider client={client}>
        <ContainerWithData />
      </ApolloProvider>
    );

    return wait(() => {
      expect(renderCount).toBe(2);
    }).then(resolve, reject);
  });

  itAsync('allows for updating queries from a mutation automatically', (resolve, reject) => {
    const query: DocumentNode = gql`
      query getMini($id: ID!) {
        mini(id: $id) {
          __typename
          id
          cover(maxWidth: 600, maxHeight: 400)
        }
      }
    `;

    const queryData = {
      mini: {
        id: 1,
        __typename: 'Mini',
        cover: 'image1'
      }
    };

    type Data = typeof queryData;

    const variables = { id: 1 };

    type Variables = typeof variables;

    const mutation: DocumentNode = gql`
      mutation($signature: String!) {
        mini: submitMiniCoverS3DirectUpload(signature: $signature) {
          __typename
          id
          cover(maxWidth: 600, maxHeight: 400)
        }
      }
    `;

    const mutationData = {
      mini: {
        id: 1,
        cover: 'image2',
        __typename: 'Mini'
      }
    };

    type MutationData = typeof mutationData;

    interface MutationVariables {
      signature: string;
    }

    const link = mockSingleLink(
      { request: { query, variables }, result: { data: queryData } },
      {
        request: { query: mutation, variables: { signature: '1233' } },
        result: { data: mutationData }
      }
    );
    const cache = new Cache({ addTypename: false });
    const client = new ApolloClient({ link, cache });

    class Boundary extends React.Component {
      componentDidCatch(e: any) {
        reject(e);
      }
      render() {
        return this.props.children;
      }
    }

    let count = 0;
    const MutationContainer = graphql<MutationVariables, MutationData>(
      mutation
    )(
      class extends React.Component<
        ChildProps<MutationVariables, MutationData>
      > {
        render() {
          if (count === 1) {
            setTimeout(() => {
              this.props.mutate!()
                .then(result => {
                  expect(stripSymbols(result && result.data)).toEqual(
                    mutationData
                  );
                })
                .catch(reject);
            });
          }
          return null;
        }
      }
    );

    const Container = graphql<Variables, Data>(query)(
      class extends React.Component<ChildProps<Variables, Data>> {
        render() {
          if (count === 1) {
            expect(stripSymbols(this.props.data!.mini)).toEqual(queryData.mini);
          }
          if (count === 2) {
            expect(stripSymbols(this.props.data!.mini)).toEqual(
              mutationData.mini
            );
          }
          count++;

          return (
            <MutationContainer {...this.props.data!.mini} signature="1233" />
          );
        }
      }
    );

    render(
      <ApolloProvider client={client}>
        <Boundary>
          <Container id={1} />
        </Boundary>
      </ApolloProvider>
    );

    return wait(() => {
      expect(count).toBe(3);
    }).then(resolve, reject);
  });

  it('should be able to override the internal `ignoreResults` setting', async () => {
    const mutation: DocumentNode = gql`
      mutation($signature: String!) {
        mini: submitMiniCoverS3DirectUpload(signature: $signature) {
          __typename
          id
          cover(maxWidth: 600, maxHeight: 400)
        }
      }
    `;

    const mutationData = {
      mini: {
        id: 1,
        cover: 'image2',
        __typename: 'Mini'
      }
    };

    type MutationData = typeof mutationData;

    interface MutationVariables {
      signature: string;
    }

    const link = mockSingleLink({
      request: { query: mutation, variables: { signature: '1233' } },
      result: { data: mutationData }
    });

    const cache = new Cache({ addTypename: false });
    const client = new ApolloClient({ link, cache });

    let renderCount = 0;
    const MutationContainer = graphql<MutationVariables, MutationData>(
      mutation,
      { options: { ignoreResults: false } }
    )(
      class extends React.Component<
        ChildProps<MutationVariables, MutationData>
      > {
        render() {
          switch (renderCount) {
            case 0:
              expect(this.props.result!.loading).toBeFalsy();
              setTimeout(() => {
                this.props.mutate!().then(result => {
                  expect(stripSymbols(result && result.data)).toEqual(
                    mutationData
                  );
                });
              });
              break;
            case 1:
              expect(this.props.result!.loading).toBeTruthy();
              break;
            case 2:
              expect(this.props.result!.loading).toBeFalsy();
            default: // Do nothing
          }

          renderCount += 1;
          return null;
        }
      }
    );

    render(
      <ApolloProvider client={client}>
        <MutationContainer signature="1233" />
      </ApolloProvider>
    );

    await wait(() => {
      expect(renderCount).toBe(3);
    });
  });
});
