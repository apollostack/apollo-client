import gql from 'graphql-tag';
import { GraphQLError } from 'graphql';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';

import { ApolloClient, NetworkStatus } from '../../core';
import { ObservableQuery } from '../ObservableQuery';
import { QueryManager } from '../QueryManager';

import { Observable } from '../../utilities';
import { ApolloLink } from '../../link/core';
import { InMemoryCache, NormalizedCacheObject } from '../../cache';
import { ApolloError } from '../../errors';

import { itAsync, stripSymbols, mockSingleLink, subscribeAndCount } from '../../testing';
import mockQueryManager from '../../utilities/testing/mocking/mockQueryManager';
import mockWatchQuery from '../../utilities/testing/mocking/mockWatchQuery';
import wrap from '../../utilities/testing/wrap';

export const mockFetchQuery = (queryManager: QueryManager<any>) => {
  const fetchQueryObservable = queryManager.fetchQueryObservable;
  const fetchQueryByPolicy: QueryManager<any>["fetchQueryByPolicy"] =
    (queryManager as any).fetchQueryByPolicy;

  const mock = <T extends
    | typeof fetchQueryObservable
    | typeof fetchQueryByPolicy
  >(original: T) => jest.fn<ReturnType<T>, Parameters<T>>(function () {
    return original.apply(queryManager, arguments);
  });

  const mocks = {
    fetchQueryObservable: mock(fetchQueryObservable),
    fetchQueryByPolicy: mock(fetchQueryByPolicy),
  };

  Object.assign(queryManager, mocks);

  return mocks;
};

describe('ObservableQuery', () => {
  // Standard data for all these tests
  const query: TypedDocumentNode<{
    people_one: {
      name: string;
    };
  }> = gql`
    query query($id: ID!) {
      people_one(id: $id) {
        name
      }
    }
  `;
  const variables = { id: 1 };
  const differentVariables = { id: 2 };
  const dataOne = {
    people_one: {
      name: 'Luke Skywalker',
    },
  };
  const dataTwo = {
    people_one: {
      name: 'Leia Skywalker',
    },
  };

  const error = new GraphQLError('is offline.', undefined, null, null, ['people_one']);

  const createQueryManager = ({ link }: { link: ApolloLink }) => {
    return new QueryManager({
      link,
      assumeImmutableResults: true,
      cache: new InMemoryCache({
        addTypename: false,
      }),
    });
  };

  describe('setOptions', () => {
    describe('to change pollInterval', () => {
      itAsync('starts polling if goes from 0 -> something', (resolve, reject) => {
        const manager = mockQueryManager(
          reject,
          {
            request: { query, variables },
            result: { data: dataOne },
          },
          {
            request: { query, variables },
            result: { data: dataTwo },
          },
          {
            request: { query, variables },
            result: { data: dataTwo },
          },
        );

        const observable = manager.watchQuery({
          query,
          variables,
          notifyOnNetworkStatusChange: false,
        });

        subscribeAndCount(reject, observable, (handleCount, result) => {
          if (handleCount === 1) {
            expect(stripSymbols(result.data)).toEqual(dataOne);
            observable.setOptions({ query, pollInterval: 10 });
          } else if (handleCount === 2) {
            expect(stripSymbols(result.data)).toEqual(dataTwo);
            observable.stopPolling();
            resolve();
          }
        });
      });

      itAsync('stops polling if goes from something -> 0', (resolve, reject) => {
        const manager = mockQueryManager(
          reject,
          {
            request: { query, variables },
            result: { data: dataOne },
          },
          {
            request: { query, variables },
            result: { data: dataTwo },
          },
          {
            request: { query, variables },
            result: { data: dataTwo },
          },
        );

        const observable = manager.watchQuery({
          query,
          variables,
          pollInterval: 10,
        });

        subscribeAndCount(reject, observable, (handleCount, result) => {
          if (handleCount === 1) {
            expect(stripSymbols(result.data)).toEqual(dataOne);
            observable.setOptions({ query, pollInterval: 0 });
            setTimeout(resolve, 5);
          } else if (handleCount === 2) {
            reject(new Error('Should not get more than one result'));
          }
        });
      });

      itAsync('can change from x>0 to y>0', (resolve, reject) => {
        const manager = mockQueryManager(
          reject,
          {
            request: { query, variables },
            result: { data: dataOne },
          },
          {
            request: { query, variables },
            result: { data: dataTwo },
          },
          {
            request: { query, variables },
            result: { data: dataTwo },
          },
        );

        const observable = manager.watchQuery({
          query,
          variables,
          pollInterval: 100,
          notifyOnNetworkStatusChange: false,
        });

        subscribeAndCount(reject, observable, (handleCount, result) => {
          if (handleCount === 1) {
            expect(stripSymbols(result.data)).toEqual(dataOne);
            observable.setOptions({ query, pollInterval: 10 });
          } else if (handleCount === 2) {
            expect(stripSymbols(result.data)).toEqual(dataTwo);
            observable.stopPolling();
            resolve();
          }
        });
      });
    });

    itAsync('does not break refetch', (resolve, reject) => {
      // This query and variables are copied from react-apollo
      const queryWithVars = gql`
        query people($first: Int) {
          allPeople(first: $first) {
            people {
              name
            }
          }
        }
      `;

      const data = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };
      const variables1 = { first: 0 };

      const data2 = { allPeople: { people: [{ name: 'Leia Skywalker' }] } };
      const variables2 = { first: 1 };

      const queryManager = mockQueryManager(
        reject,
        {
          request: {
            query: queryWithVars,
            variables: variables1,
          },
          result: { data },
        },
        {
          request: {
            query: queryWithVars,
            variables: variables2,
          },
          result: { data: data2 },
        },
      );

      const observable = queryManager.watchQuery({
        query: queryWithVars,
        variables: variables1,
        notifyOnNetworkStatusChange: true,
      });

      subscribeAndCount(reject, observable, (handleCount, result) => {
        if (handleCount === 1) {
          expect(result.data).toEqual(data);
          expect(result.loading).toBe(false);
          return observable.refetch(variables2);
        } else if (handleCount === 2) {
          expect(result.loading).toBe(true);
          expect(result.networkStatus).toBe(NetworkStatus.setVariables);
        } else if (handleCount === 3) {
          expect(result.loading).toBe(false);
          expect(result.data).toEqual(data2);
          resolve();
        }
      });
    });

    itAsync('rerenders when refetch is called', (resolve, reject) => {
      // This query and variables are copied from react-apollo
      const query = gql`
        query people($first: Int) {
          allPeople(first: $first) {
            people {
              name
            }
          }
        }
      `;

      const data = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };
      const variables = { first: 0 };

      const data2 = { allPeople: { people: [{ name: 'Leia Skywalker' }] } };

      const queryManager = mockQueryManager(
        reject,
        {
          request: {
            query,
            variables,
          },
          result: { data },
        },
        {
          request: {
            query,
            variables,
          },
          result: { data: data2 },
        },
      );

      const observable = queryManager.watchQuery({
        query,
        variables,
        notifyOnNetworkStatusChange: true,
      });

      subscribeAndCount(reject, observable, (handleCount, result) => {
        if (handleCount === 1) {
          expect(result.loading).toEqual(false);
          expect(result.data).toEqual(data);
          return observable.refetch();
        } else if (handleCount === 2) {
          expect(result.loading).toEqual(true);
          expect(result.networkStatus).toEqual(NetworkStatus.refetch);
        } else if (handleCount === 3) {
          expect(result.loading).toEqual(false);
          expect(result.data).toEqual(data2);
          resolve();
        }
      });
    });

    itAsync('rerenders with new variables then shows correct data for previous variables', (resolve, reject) => {
      // This query and variables are copied from react-apollo
      const query = gql`
        query people($first: Int) {
          allPeople(first: $first) {
            people {
              name
            }
          }
        }
      `;

      const data = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };
      const variables = { first: 0 };

      const data2 = { allPeople: { people: [{ name: 'Leia Skywalker' }] } };
      const variables2 = { first: 1 };

      const observable: ObservableQuery<any> = mockWatchQuery(
        reject,
        {
          request: {
            query,
            variables,
          },
          result: { data },
        },
        {
          request: {
            query,
            variables: variables2,
          },
          result: { data: data2 },
        },
      );

      subscribeAndCount(reject, observable, async (handleCount, result) => {
        if (handleCount === 1) {
          expect(result.data).toEqual(data);
          expect(result.loading).toBe(false);
          await observable.setOptions({
            variables: variables2,
            notifyOnNetworkStatusChange: true,
          });
        } else if (handleCount === 2) {
          expect(result.loading).toBe(true);
          expect(result.networkStatus).toBe(NetworkStatus.setVariables);
        } else if (handleCount === 3) {
          expect(result.loading).toBe(false);
          expect(result.data).toEqual(data2);
          // go back to first set of variables
          const current = await observable.reobserve({ variables });
          expect(current.data).toEqual(data);
          resolve();
        }
      });
    });

    // TODO: Something isn't quite right with this test. It's failing but not
    // for the right reasons.
    itAsync.skip('if query is refetched, and an error is returned, no other observer callbacks will be called', (resolve, reject) => {
      const observable: ObservableQuery<any> = mockWatchQuery(
        reject,
        {
          request: { query, variables },
          result: { data: dataOne },
        },
        {
          request: { query, variables },
          result: { errors: [error] },
        },
        {
          request: { query, variables },
          result: { data: dataOne },
        },
      );

      let handleCount = 0;
      observable.subscribe({
        next: result => {
          handleCount++;
          if (handleCount === 1) {
            expect(stripSymbols(result.data)).toEqual(dataOne);
            observable.refetch();
          } else if (handleCount === 3) {
            throw new Error("next shouldn't fire after an error");
          }
        },
        error: () => {
          handleCount++;
          expect(handleCount).toBe(2);
          observable.refetch();
          setTimeout(resolve, 25);
        },
      });
    });

    itAsync('does a network request if fetchPolicy becomes networkOnly', (resolve, reject) => {
      const observable: ObservableQuery<any> = mockWatchQuery(
        reject,
        {
          request: { query, variables },
          result: { data: dataOne },
        },
        {
          request: { query, variables },
          result: { data: dataTwo },
        },
      );

      subscribeAndCount(reject, observable, (handleCount, result) => {
        if (handleCount === 1) {
          expect(result.loading).toBe(false);
          expect(result.data).toEqual(dataOne);
          return observable.setOptions({ fetchPolicy: 'network-only' });
        } else if (handleCount === 2) {
          expect(result.loading).toBe(false);
          expect(result.data).toEqual(dataTwo);
          resolve();
        }
      });
    });

    itAsync('does a network request if fetchPolicy is cache-only then store is reset then fetchPolicy becomes not cache-only', (resolve, reject) => {
      const testQuery = gql`
        query {
          author {
            firstName
            lastName
          }
        }
      `;
      const data = {
        author: {
          firstName: 'John',
          lastName: 'Smith',
        },
      };

      let timesFired = 0;
      const link: ApolloLink = ApolloLink.from([
        () => new Observable(observer => {
          timesFired += 1;
          observer.next({ data });
          observer.complete();
        }),
      ]);

      const queryManager = createQueryManager({ link });
      // fetch first data from server
      const observable = queryManager.watchQuery({
        query: testQuery,
      });

      subscribeAndCount(reject, observable, async (handleCount, result) => {
        if (handleCount === 1) {
          expect(result.data).toEqual(data);
          expect(timesFired).toBe(1);
          // set policy to be cache-only but data is found
          await observable.setOptions({ fetchPolicy: 'cache-only' });
          await queryManager.resetStore();
        } else if (handleCount === 2) {
          expect(result.data).toEqual({});
          expect(result.loading).toBe(false);
          expect(result.networkStatus).toBe(NetworkStatus.ready);
          expect(timesFired).toBe(1);
          resolve();
        }
      });
    });

    itAsync('does a network request if fetchPolicy changes from cache-only', (resolve, reject) => {
      const testQuery = gql`
        query {
          author {
            firstName
            lastName
          }
        }
      `;
      const data = {
        author: {
          firstName: 'John',
          lastName: 'Smith',
        },
      };

      let timesFired = 0;
      const link: ApolloLink = ApolloLink.from([
        () => {
          return new Observable(observer => {
            timesFired += 1;
            observer.next({ data });
            observer.complete();
          });
        },
      ]);

      const queryManager = createQueryManager({ link });

      const observable = queryManager.watchQuery({
        query: testQuery,
        fetchPolicy: 'cache-only',
        notifyOnNetworkStatusChange: false,
      });

      subscribeAndCount(reject, observable, (handleCount, result) => {
        if (handleCount === 1) {
          expect(result.loading).toBe(false);
          expect(result.data).toEqual({});
          expect(timesFired).toBe(0);
          observable.setOptions({ fetchPolicy: 'cache-first' });
        } else if (handleCount === 2) {
          expect(result.loading).toBe(false);
          expect(result.data).toEqual(data);
          expect(timesFired).toBe(1);
          resolve();
        }
      });
    });

    itAsync('can set queries to standby and will not fetch when doing so', (resolve, reject) => {
      let queryManager: QueryManager<NormalizedCacheObject>;
      let observable: ObservableQuery<any>;
      const testQuery = gql`
        query {
          author {
            firstName
            lastName
          }
        }
      `;
      const data = {
        author: {
          firstName: 'John',
          lastName: 'Smith',
        },
      };

      let timesFired = 0;
      const link: ApolloLink = ApolloLink.from([
        () => {
          return new Observable(observer => {
            timesFired += 1;
            observer.next({ data });
            observer.complete();
            return;
          });
        },
      ]);
      queryManager = createQueryManager({ link });
      observable = queryManager.watchQuery({
        query: testQuery,
        fetchPolicy: 'cache-first',
        notifyOnNetworkStatusChange: false,
      });

      subscribeAndCount(reject, observable, async (handleCount, result) => {
        if (handleCount === 1) {
          expect(stripSymbols(result.data)).toEqual(data);
          expect(timesFired).toBe(1);
          await observable.setOptions({ query, fetchPolicy: 'standby' });
          // make sure the query didn't get fired again.
          expect(timesFired).toBe(1);
          resolve();
        } else if (handleCount === 2) {
          throw new Error('Handle should not be triggered on standby query');
        }
      });
    });

    itAsync('will not fetch when setting a cache-only query to standby', (resolve, reject) => {
      let queryManager: QueryManager<NormalizedCacheObject>;
      let observable: ObservableQuery<any>;
      const testQuery = gql`
        query {
          author {
            firstName
            lastName
          }
        }
      `;
      const data = {
        author: {
          firstName: 'John',
          lastName: 'Smith',
        },
      };

      let timesFired = 0;
      const link: ApolloLink = ApolloLink.from([
        () => {
          return new Observable(observer => {
            timesFired += 1;
            observer.next({ data });
            observer.complete();
            return;
          });
        },
      ]);
      queryManager = createQueryManager({ link });

      queryManager.query({ query: testQuery }).then(() => {
        observable = queryManager.watchQuery({
          query: testQuery,
          fetchPolicy: 'cache-first',
          notifyOnNetworkStatusChange: false,
        });

        subscribeAndCount(reject, observable, async (handleCount, result) => {
          if (handleCount === 1) {
            expect(stripSymbols(result.data)).toEqual(data);
            expect(timesFired).toBe(1);
            await observable.setOptions({ query, fetchPolicy: 'standby' });
            // make sure the query didn't get fired again.
            expect(timesFired).toBe(1);
            resolve();
          } else if (handleCount === 2) {
            throw new Error('Handle should not be triggered on standby query');
          }
        });
      });
    });

    itAsync('returns a promise which eventually returns data', (resolve, reject) => {
      const observable: ObservableQuery<any> = mockWatchQuery(
        reject,
        {
          request: { query, variables },
          result: { data: dataOne },
        },
        {
          request: { query, variables },
          result: { data: dataTwo },
        },
      );

      subscribeAndCount(reject, observable, (handleCount, result) => {
        if (handleCount === 1) {
          expect(result.data).toEqual(dataOne);
          observable.setOptions({
            fetchPolicy: 'cache-and-network',
          }).then(res => {
            expect(res.data).toEqual(dataTwo);
          }).then(resolve, reject);
        }
      });
    });
  });

  describe('setVariables', () => {
    itAsync('reruns query if the variables change', (resolve, reject) => {
      const queryManager = mockQueryManager(
        reject,
        {
          request: { query, variables },
          result: { data: dataOne },
        },
        {
          request: { query, variables: differentVariables },
          result: { data: dataTwo },
        },
      );

      const observable = queryManager.watchQuery({
        query,
        variables,
        notifyOnNetworkStatusChange: true,
      });

      subscribeAndCount(reject, observable, (handleCount, result) => {
        if (handleCount === 1) {
          expect(result.loading).toBe(false);
          expect(stripSymbols(result.data)).toEqual(dataOne);
          return observable.setVariables(differentVariables);
        } else if (handleCount === 2) {
          expect(result.loading).toBe(true);
          expect(result.networkStatus).toBe(NetworkStatus.setVariables);
        } else if (handleCount === 3) {
          expect(result.loading).toBe(false);
          expect(stripSymbols(result.data)).toEqual(dataTwo);
          resolve();
        }
      });
    });

    itAsync('does invalidate the currentResult data if the variables change', (resolve, reject) => {
      const observable: ObservableQuery<any> = mockWatchQuery(
        reject,
        {
          request: { query, variables },
          result: { data: dataOne },
        },
        {
          request: { query, variables: differentVariables },
          result: { data: dataTwo },
          delay: 25,
        },
      );

      subscribeAndCount(reject, observable, async (handleCount, result) => {
        if (handleCount === 1) {
          expect(stripSymbols(result.data)).toEqual(dataOne);
          expect(stripSymbols(observable.getCurrentResult().data)).toEqual(
            dataOne,
          );
          await observable.setVariables(differentVariables);
        }
        expect(observable.getCurrentResult().data).toEqual(dataTwo);
        expect(observable.getCurrentResult().loading).toBe(false);
        resolve();
      });
    });

    itAsync('does invalidate the currentResult data if the variables change', (resolve, reject) => {
      // Standard data for all these tests
      const query = gql`
        query UsersQuery($page: Int) {
          users {
            id
            name
            posts(page: $page) {
              title
            }
          }
        }
      `;
      const variables = { page: 1 };
      const differentVariables = { page: 2 };
      const dataOne = {
        users: [
          {
            id: 1,
            name: 'James',
            posts: [{ title: 'GraphQL Summit' }, { title: 'Awesome' }],
          },
        ],
      };
      const dataTwo = {
        users: [
          {
            id: 1,
            name: 'James',
            posts: [{ title: 'Old post' }],
          },
        ],
      };

      const observable: ObservableQuery<any> = mockWatchQuery(
        reject,
        {
          request: { query, variables },
          result: { data: dataOne },
        },
        {
          request: { query, variables: differentVariables },
          result: { data: dataTwo },
          delay: 25,
        },
      );

      subscribeAndCount(reject, observable, async (handleCount, result) => {
        if (handleCount === 1) {
          expect(stripSymbols(result.data)).toEqual(dataOne);
          expect(stripSymbols(observable.getCurrentResult().data)).toEqual(
            dataOne,
          );
          await observable.setVariables(differentVariables);
        }
        expect(observable.getCurrentResult().data).toEqual(dataTwo);
        expect(observable.getCurrentResult().loading).toBe(false);
        resolve();
      });
    });

    itAsync('does not invalidate the currentResult errors if the variables change', (resolve, reject) => {
      const queryManager = mockQueryManager(
        reject,
        {
          request: { query, variables },
          result: { errors: [error] },
        },
        {
          request: { query, variables: differentVariables },
          result: { data: dataTwo },
        },
      );

      const observable = queryManager.watchQuery({
        query,
        variables,
        errorPolicy: 'all',
      });

      subscribeAndCount(reject, observable, (handleCount, result) => {
        if (handleCount === 1) {
          expect(result.errors).toEqual([error]);
          expect(observable.getCurrentResult().errors).toEqual([error]);
          observable.setVariables(differentVariables);
          expect(observable.getCurrentResult().errors).toEqual([error]);
        } else if (handleCount === 2) {
          expect(stripSymbols(result.data)).toEqual(dataTwo);
          expect(stripSymbols(observable.getCurrentResult().data)).toEqual(
            dataTwo,
          );
          expect(observable.getCurrentResult().loading).toBe(false);
          resolve();
        }
      });
    });

    itAsync('does not perform a query when unsubscribed if variables change', (resolve, reject) => {
      // Note: no responses, will throw if a query is made
      const queryManager = mockQueryManager(reject);
      const observable = queryManager.watchQuery({ query, variables });
      return observable.setVariables(differentVariables)
        .then(resolve, reject);
    });

    itAsync('sets networkStatus to `setVariables` when fetching', (resolve, reject) => {
      const mockedResponses = [
        {
          request: { query, variables },
          result: { data: dataOne },
        },
        {
          request: { query, variables: differentVariables },
          result: { data: dataTwo },
        },
      ];

      const queryManager = mockQueryManager(reject, ...mockedResponses);
      const firstRequest = mockedResponses[0].request;
      const observable = queryManager.watchQuery({
        query: firstRequest.query,
        variables: firstRequest.variables,
        notifyOnNetworkStatusChange: true,
      });

      subscribeAndCount(reject, observable, (handleCount, result) => {
        if (handleCount === 1) {
          expect(result.loading).toBe(false);
          expect(stripSymbols(result.data)).toEqual(dataOne);
          expect(result.networkStatus).toBe(NetworkStatus.ready);
          observable.setVariables(differentVariables);
        } else if (handleCount === 2) {
          expect(result.loading).toBe(true);
          expect(result.networkStatus).toBe(NetworkStatus.setVariables);
        } else if (handleCount === 3) {
          expect(result.loading).toBe(false);
          expect(result.networkStatus).toBe(NetworkStatus.ready);
          expect(stripSymbols(result.data)).toEqual(dataTwo);
          resolve();
        }
      });
    });

    itAsync('sets networkStatus to `setVariables` when calling refetch with new variables', (resolve, reject) => {
      const mockedResponses = [
        {
          request: { query, variables },
          result: { data: dataOne },
        },
        {
          request: { query, variables: differentVariables },
          result: { data: dataTwo },
        },
      ];

      const queryManager = mockQueryManager(reject, ...mockedResponses);
      const firstRequest = mockedResponses[0].request;
      const observable = queryManager.watchQuery({
        query: firstRequest.query,
        variables: firstRequest.variables,
        notifyOnNetworkStatusChange: true,
      });

      subscribeAndCount(reject, observable, (handleCount, result) => {
        if (handleCount === 1) {
          expect(result.loading).toBe(false);
          expect(stripSymbols(result.data)).toEqual(dataOne);
          expect(result.networkStatus).toBe(NetworkStatus.ready);
          observable.refetch(differentVariables);
        } else if (handleCount === 2) {
          expect(result.loading).toBe(true);
          expect(result.networkStatus).toBe(NetworkStatus.setVariables);
        } else if (handleCount === 3) {
          expect(result.loading).toBe(false);
          expect(result.networkStatus).toBe(NetworkStatus.ready);
          expect(stripSymbols(result.data)).toEqual(dataTwo);
          resolve();
        }
      });
    });

    itAsync('does not rerun query if variables do not change', (resolve, reject) => {
      const observable: ObservableQuery<any> = mockWatchQuery(
        reject,
        {
          request: { query, variables },
          result: { data: dataOne },
        },
        {
          request: { query, variables },
          result: { data: dataTwo },
        },
      );

      let errored = false;
      subscribeAndCount(reject, observable, (handleCount, result) => {
        if (handleCount === 1) {
          expect(stripSymbols(result.data)).toEqual(dataOne);
          observable.setVariables(variables);

          // Nothing should happen, so we'll wait a moment to check that
          setTimeout(() => !errored && resolve(), 10);
        } else if (handleCount === 2) {
          errored = true;
          throw new Error('Observable callback should not fire twice');
        }
      });
    });

    itAsync('handles variables changing while a query is in-flight', (resolve, reject) => {
      // The expected behavior is that the original variables are forgotten
      // and the query stays in loading state until the result for the new variables
      // has returned.
      const observable: ObservableQuery<any> = mockWatchQuery(
        reject,
        {
          request: { query, variables },
          result: { data: dataOne },
          delay: 20,
        },
        {
          request: { query, variables: differentVariables },
          result: { data: dataTwo },
          delay: 20,
        },
      );

      observable.setVariables(differentVariables);

      subscribeAndCount(reject, observable, (handleCount, result) => {
        if (handleCount === 1) {
          expect(result.networkStatus).toBe(NetworkStatus.ready);
          expect(result.loading).toBe(false);
          expect(stripSymbols(result.data)).toEqual(dataTwo);
          resolve();
        } else {
          reject(new Error("should not deliver more than one result"));
        }
      });
    });
  });

  describe('refetch', () => {
    itAsync('calls fetchRequest with fetchPolicy `network-only` when using a non-networked fetch policy', (resolve, reject) => {
      const mockedResponses = [
        {
          request: { query, variables },
          result: { data: dataOne },
        },
        {
          request: { query, variables: differentVariables },
          result: { data: dataTwo },
        },
      ];

      const queryManager = mockQueryManager(reject, ...mockedResponses);
      const firstRequest = mockedResponses[0].request;
      const observable = queryManager.watchQuery({
        query: firstRequest.query,
        variables: firstRequest.variables,
        fetchPolicy: 'cache-first',
      });

      const mocks = mockFetchQuery(queryManager);

      subscribeAndCount(reject, observable, (count, result) => {
        if (count === 1) {
          expect(result).toEqual({
            loading: false,
            networkStatus: NetworkStatus.ready,
            data: dataOne,
          });

          observable.refetch(differentVariables);

        } else if (count === 2) {
          expect(result).toEqual({
            loading: false,
            networkStatus: NetworkStatus.ready,
            data: dataTwo,
          });

          const fqbpCalls = mocks.fetchQueryByPolicy.mock.calls;
          expect(fqbpCalls.length).toBe(2);
          expect(fqbpCalls[0][1].fetchPolicy).toEqual('cache-first');
          expect(fqbpCalls[1][1].fetchPolicy).toEqual('network-only');

          const fqoCalls = mocks.fetchQueryObservable.mock.calls;
          expect(fqoCalls.length).toBe(2);
          expect(fqoCalls[0][1].fetchPolicy).toEqual('cache-first');
          expect(fqoCalls[1][1].fetchPolicy).toEqual('network-only');

          // Although the options.fetchPolicy we passed just now to
          // fetchQueryByPolicy should have been network-only,
          // observable.options.fetchPolicy should now be updated to
          // cache-first, thanks to options.nextFetchPolicy.
          expect(observable.options.fetchPolicy).toBe('cache-first');

          // Give the test time to fail if more results are delivered.
          setTimeout(resolve, 50);
        } else {
          reject(new Error(`too many results (${count}, ${result})`));
        }
      });
    });

    itAsync(
      'calls fetchRequest with fetchPolicy `no-cache` when using `no-cache` fetch policy',
      (resolve, reject) => {
        const mockedResponses = [
          {
            request: { query, variables },
            result: { data: dataOne },
          },
          {
            request: { query, variables: differentVariables },
            result: { data: dataTwo },
          },
        ];

        const queryManager = mockQueryManager(reject, ...mockedResponses);
        const firstRequest = mockedResponses[0].request;
        const observable = queryManager.watchQuery({
          query: firstRequest.query,
          variables: firstRequest.variables,
          fetchPolicy: 'no-cache',
        });

        const mocks = mockFetchQuery(queryManager);

        subscribeAndCount(reject, observable, handleCount => {
          if (handleCount === 1) {
            observable.refetch(differentVariables);
          } else if (handleCount === 2) {
            const fqbpCalls = mocks.fetchQueryByPolicy.mock.calls;
            expect(fqbpCalls.length).toBe(2);
            expect(fqbpCalls[1][1].fetchPolicy).toBe('no-cache');

            // Unlike network-only or cache-and-network, the no-cache
            // FetchPolicy does not switch to cache-first after the first
            // network request.
            expect(observable.options.fetchPolicy).toBe('no-cache');
            const fqoCalls = mocks.fetchQueryObservable.mock.calls;
            expect(fqoCalls.length).toBe(2);
            expect(fqoCalls[1][1].fetchPolicy).toBe('no-cache');

            resolve();
          }
        });
      }
    );

    itAsync('calls ObservableQuery.next even after hitting cache', (resolve, reject) => {
      // This query and variables are copied from react-apollo
      const queryWithVars = gql`
        query people($first: Int) {
          allPeople(first: $first) {
            people {
              name
            }
          }
        }
      `;

      const data = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };
      const variables1 = { first: 0 };

      const data2 = { allPeople: { people: [{ name: 'Leia Skywalker' }] } };
      const variables2 = { first: 1 };

      const queryManager = mockQueryManager(
        reject,
        {
          request: {
            query: queryWithVars,
            variables: variables1,
          },
          result: { data },
        },
        {
          request: {
            query: queryWithVars,
            variables: variables2,
          },
          result: { data: data2 },
        },
        {
          request: {
            query: queryWithVars,
            variables: variables1,
          },
          result: { data },
        },
      );

      const observable = queryManager.watchQuery({
        query: queryWithVars,
        variables: variables1,
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
      });

      subscribeAndCount(reject, observable, (handleCount, result) => {
        if (handleCount === 1) {
          expect(result.data).toEqual(data);
          expect(result.loading).toBe(false);
          observable.refetch(variables2);
        } else if (handleCount === 2) {
          expect(result.loading).toBe(true);
          expect(result.networkStatus).toBe(NetworkStatus.setVariables);
        } else if (handleCount === 3) {
          expect(result.data).toEqual(data2);
          expect(result.loading).toBe(false);
          observable.refetch(variables1);
        } else if (handleCount === 4) {
          expect(result.loading).toBe(true);
          expect(result.networkStatus).toBe(NetworkStatus.setVariables);
        } else if (handleCount === 5) {
          expect(result.data).toEqual(data);
          expect(result.loading).toBe(false);
          resolve();
        }
      });
    });

    itAsync('resets fetchPolicy when variables change when using nextFetchPolicy', (resolve, reject) => {
      // This query and variables are copied from react-apollo
      const queryWithVars = gql`
        query people($first: Int) {
          allPeople(first: $first) {
            people {
              name
            }
          }
        }
      `;

      const data = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };
      const variables1 = { first: 0 };

      const data2 = { allPeople: { people: [{ name: 'Leia Skywalker' }] } };
      const variables2 = { first: 1 };

      const queryManager = mockQueryManager(
        reject,
        {
          request: {
            query: queryWithVars,
            variables: variables1,
          },
          result: { data },
        },
        {
          request: {
            query: queryWithVars,
            variables: variables2,
          },
          result: { data: data2 },
        },
        {
          request: {
            query: queryWithVars,
            variables: variables1,
          },
          result: { data },
        },
        {
          request: {
            query: queryWithVars,
            variables: variables2,
          },
          result: { data: data2 },
        },
      );

      const observable = queryManager.watchQuery({
        query: queryWithVars,
        variables: variables1,
        fetchPolicy: 'cache-and-network',
        nextFetchPolicy: 'cache-first',
        notifyOnNetworkStatusChange: true,
      });

      expect(observable.options.fetchPolicy).toBe('cache-and-network');
      expect(observable["initialFetchPolicy"]).toBe('cache-and-network');

      subscribeAndCount(reject, observable, (handleCount, result) => {
        expect(result.error).toBeUndefined();

        if (handleCount === 1) {
          expect(result.data).toEqual(data);
          expect(result.loading).toBe(false);
          expect(observable.options.fetchPolicy).toBe('cache-first');
          observable.refetch(variables2);
        } else if (handleCount === 2) {
          expect(result.loading).toBe(true);
          expect(result.networkStatus).toBe(NetworkStatus.setVariables);
          expect(observable.options.fetchPolicy).toBe('cache-first');
        } else if (handleCount === 3) {
          expect(result.data).toEqual(data2);
          expect(result.loading).toBe(false);
          expect(observable.options.fetchPolicy).toBe('cache-first');
          observable.setOptions({
            variables: variables1,
          }).then(result => {
            expect(result.data).toEqual(data);
          }).catch(reject);
          expect(observable.options.fetchPolicy).toBe('cache-and-network');
        } else if (handleCount === 4) {
          expect(result.loading).toBe(true);
          expect(result.networkStatus).toBe(NetworkStatus.setVariables);
          expect(observable.options.fetchPolicy).toBe('cache-first');
        } else if (handleCount === 5) {
          expect(result.data).toEqual(data);
          expect(result.loading).toBe(false);
          expect(observable.options.fetchPolicy).toBe('cache-first');
          observable.reobserve({
            variables: variables2,
          }).then(result => {
            expect(result.data).toEqual(data2);
          }).catch(reject);
          expect(observable.options.fetchPolicy).toBe('cache-and-network');
        } else if (handleCount === 6) {
          expect(result.data).toEqual(data2);
          expect(result.loading).toBe(true);
          expect(observable.options.fetchPolicy).toBe('cache-first');
        } else if (handleCount === 7) {
          expect(result.data).toEqual(data2);
          expect(result.loading).toBe(false);
          expect(observable.options.fetchPolicy).toBe('cache-first');
          setTimeout(resolve, 10);
        } else {
          reject(`too many renders (${handleCount})`);
        }
      });
    });

    itAsync('cache-and-network refetch should run @client(always: true) resolvers when network request fails', (resolve, reject) => {
      const query = gql`
        query MixedQuery {
          counter @client(always: true)
          name
        }
      `;

      let count = 0;

      let linkObservable = Observable.of({
        data: {
          name: 'Ben',
        },
      });

      const intentionalNetworkFailure = new ApolloError({
        networkError: new Error('intentional network failure'),
      });

      const errorObservable: typeof linkObservable = new Observable(
        observer => {
          observer.error(intentionalNetworkFailure);
        },
      );

      const client = new ApolloClient({
        link: new ApolloLink(request => linkObservable),
        cache: new InMemoryCache(),
        resolvers: {
          Query: {
            counter() {
              return ++count;
            },
          },
        },
      });

      const observable = client.watchQuery({
        query,
        fetchPolicy: 'cache-and-network',
        returnPartialData: true,
      });

      let handleCount = 0;
      observable.subscribe({
        error(error) {
          expect(error).toBe(intentionalNetworkFailure);
        },

        next(result) {
          ++handleCount;

          if (handleCount === 1) {
            expect(result).toEqual({
              data: {
                counter: 1,
              },
              loading: true,
              networkStatus: NetworkStatus.loading,
              partial: true,
            });
          } else if (handleCount === 2) {
            expect(result).toEqual({
              data: {
                counter: 2,
                name: 'Ben',
              },
              loading: false,
              networkStatus: NetworkStatus.ready,
            });

            const oldLinkObs = linkObservable;
            // Make the next network request fail.
            linkObservable = errorObservable;

            observable.refetch().then(
              () => {
                reject(new Error('should have gotten an error'));
              },

              error => {
                expect(error).toBe(intentionalNetworkFailure);

                // Switch back from errorObservable.
                linkObservable = oldLinkObs;

                observable.refetch().then(result => {
                  expect(result).toEqual({
                    data: {
                      counter: 5,
                      name: 'Ben',
                    },
                    loading: false,
                    networkStatus: NetworkStatus.ready,
                  });
                  setTimeout(resolve, 50);
                }, reject);
              },
            );
          } else if (handleCount === 3) {
            expect(result).toEqual({
              data: {
                counter: 3,
                name: 'Ben',
              },
              loading: true,
              networkStatus: NetworkStatus.refetch,
            });
          } else if (handleCount > 3) {
            reject(new Error('should not get here'));
          }
        },
      });
    });
  });

  describe('currentResult', () => {
    itAsync('returns the same value as observableQuery.next got', (resolve, reject) => {
      const queryWithFragment = gql`
        fragment CatInfo on Cat {
          isTabby
          __typename
        }

        fragment DogInfo on Dog {
          hasBrindleCoat
          __typename
        }

        fragment PetInfo on Pet {
          id
          name
          age
          ... on Cat {
            ...CatInfo
            __typename
          }
          ... on Dog {
            ...DogInfo
            __typename
          }
          __typename
        }

        {
          pets {
            ...PetInfo
            __typename
          }
        }
      `;

      const petData = [
        {
          id: 1,
          name: 'Phoenix',
          age: 6,
          isTabby: true,
          __typename: 'Cat',
        },
        {
          id: 2,
          name: 'Tempe',
          age: 3,
          isTabby: false,
          __typename: 'Cat',
        },
        {
          id: 3,
          name: 'Robin',
          age: 10,
          hasBrindleCoat: true,
          __typename: 'Dog',
        },
      ];

      const dataOneWithTypename = {
        pets: petData.slice(0, 2),
      };

      const dataTwoWithTypename = {
        pets: petData.slice(0, 3),
      };

      const ni = mockSingleLink({
        request: { query: queryWithFragment, variables },
        result: { data: dataOneWithTypename },
      }, {
        request: { query: queryWithFragment, variables },
        result: { data: dataTwoWithTypename },
      }).setOnError(reject);

      const client = new ApolloClient({
        link: ni,
        cache: new InMemoryCache({
          possibleTypes: {
            Creature: ['Pet'],
            Pet: ['Dog', 'Cat'],
          },
        }),
      });

      const observable = client.watchQuery({
        query: queryWithFragment,
        variables,
        notifyOnNetworkStatusChange: true,
      });

      subscribeAndCount(reject, observable, (count, result) => {
        const { data, loading, networkStatus } = observable.getCurrentResult();
        expect(result.loading).toEqual(loading);
        expect(result.networkStatus).toEqual(networkStatus);
        expect(result.data).toEqual(data);

        if (count === 1) {
          expect(result.loading).toBe(false);
          expect(result.networkStatus).toEqual(NetworkStatus.ready);
          expect(result.data).toEqual(dataOneWithTypename);
          observable.refetch();
        } else if (count === 2) {
          expect(result.loading).toBe(true);
          expect(result.networkStatus).toEqual(NetworkStatus.refetch);
        } else if (count === 3) {
          expect(result.loading).toBe(false);
          expect(result.networkStatus).toEqual(NetworkStatus.ready);
          expect(result.data).toEqual(dataTwoWithTypename);
          setTimeout(resolve, 5);
        } else {
          reject(new Error('Observable.next called too many times'));
        }
      });
    });

    itAsync('returns the current query status immediately', (resolve, reject) => {
      const observable: ObservableQuery<any> = mockWatchQuery(reject, {
        request: { query, variables },
        result: { data: dataOne },
        delay: 100,
      });

      subscribeAndCount(reject, observable, () => {
        expect(stripSymbols(observable.getCurrentResult())).toEqual({
          data: dataOne,
          loading: false,
          networkStatus: 7,
        });
        resolve();
      });

      expect(observable.getCurrentResult()).toEqual({
        loading: true,
        data: undefined,
        networkStatus: 1,
        partial: true,
      });

      setTimeout(
        wrap(reject, () => {
          expect(observable.getCurrentResult()).toEqual({
            loading: true,
            data: undefined,
            networkStatus: 1,
            partial: true,
          });
        }),
        0,
      );
    });

    itAsync('returns results from the store immediately', (resolve, reject) => {
      const queryManager = mockQueryManager(reject, {
        request: { query, variables },
        result: { data: dataOne },
      });

      return queryManager.query({ query, variables }).then((result: any) => {
        expect(stripSymbols(result)).toEqual({
          data: dataOne,
          loading: false,
          networkStatus: 7,
        });
        const observable = queryManager.watchQuery({
          query,
          variables,
        });
        expect(stripSymbols(observable.getCurrentResult())).toEqual({
          data: dataOne,
          loading: false,
          networkStatus: NetworkStatus.ready,
        });
      }).then(resolve, reject);
    });

    itAsync('returns errors from the store immediately', (resolve, reject) => {
      const queryManager = mockQueryManager(reject, {
        request: { query, variables },
        result: { errors: [error] },
      });

      const observable = queryManager.watchQuery({
        query,
        variables,
      });

      observable.subscribe({
        error: theError => {
          expect(theError.graphQLErrors).toEqual([error]);

          const currentResult = observable.getCurrentResult();
          expect(currentResult.loading).toBe(false);
          expect(currentResult.error!.graphQLErrors).toEqual([error]);
          resolve();
        },
      });
    });

    itAsync('returns referentially equal errors', (resolve, reject) => {
      const queryManager = mockQueryManager(reject, {
        request: { query, variables },
        result: { errors: [error] },
      });

      const observable = queryManager.watchQuery({
        query,
        variables,
      });

      return observable.result().catch((theError: any) => {
        expect(theError.graphQLErrors).toEqual([error]);

        const currentResult = observable.getCurrentResult();
        expect(currentResult.loading).toBe(false);
        expect(currentResult.error!.graphQLErrors).toEqual([error]);
        const currentResult2 = observable.getCurrentResult();
        expect(currentResult.error === currentResult2.error).toBe(true);
      }).then(resolve, reject);
    });

    itAsync('returns errors with data if errorPolicy is all', (resolve, reject) => {
      const queryManager = mockQueryManager(reject, {
        request: { query, variables },
        result: { data: dataOne, errors: [error] },
      });

      const observable = queryManager.watchQuery({
        query,
        variables,
        errorPolicy: 'all',
      });

      return observable.result().then(result => {
        expect(stripSymbols(result.data)).toEqual(dataOne);
        expect(result.errors).toEqual([error]);
        const currentResult = observable.getCurrentResult();
        expect(currentResult.loading).toBe(false);
        expect(currentResult.errors).toEqual([error]);
        expect(currentResult.error).toBeUndefined();
      }).then(resolve, reject);
    });

    itAsync('errors out if errorPolicy is none', (resolve, reject) => {
      const queryManager = mockQueryManager(reject, {
        request: { query, variables },
        result: { data: dataOne, errors: [error] },
      });

      const observable = queryManager.watchQuery({
        query,
        variables,
        errorPolicy: 'none',
      });

      return observable.result().then(() => reject('Observable did not error when it should have')).catch(currentError => {
        expect(currentError).toEqual(error);
        const lastError = observable.getLastError();
        expect(lastError).toEqual(error);
        resolve()
      }).catch(reject);
    });

    itAsync('errors out if errorPolicy is none and the observable has completed', (resolve, reject) => {
      const queryManager = mockQueryManager(reject, {
        request: { query, variables },
        result: { data: dataOne, errors: [error] },
      },
      // FIXME: We shouldn't need a second mock, there should only be one network request
      {
        request: { query, variables },
        result: { data: dataOne, errors: [error] },
      });

      const observable = queryManager.watchQuery({
        query,
        variables,
        errorPolicy: 'none',
      });

      return observable.result()
      .then(() => reject('Observable did not error when it should have'))
      // We wait for the observable to error out and reobtain a promise
      .catch(() => observable.result())
      .then((result) => reject('Observable did not error the second time we fetched results when it should have'))
      .catch(currentError => {
        expect(currentError).toEqual(error);
        const lastError = observable.getLastError();
        expect(lastError).toEqual(error);
        resolve()
      }).catch(reject);
    });

    itAsync('ignores errors with data if errorPolicy is ignore', (resolve, reject) => {
      const queryManager = mockQueryManager(reject, {
        request: { query, variables },
        result: { errors: [error], data: dataOne },
      });

      const observable = queryManager.watchQuery({
        query,
        variables,
        errorPolicy: 'ignore',
      });

      return observable.result().then(result => {
        expect(stripSymbols(result.data)).toEqual(dataOne);
        expect(result.errors).toBeUndefined();
        const currentResult = observable.getCurrentResult();
        expect(currentResult.loading).toBe(false);
        expect(currentResult.errors).toBeUndefined();
        expect(currentResult.error).toBeUndefined();
      }).then(resolve, reject);
    });

    itAsync('returns partial data from the store immediately', (resolve, reject) => {
      const superQuery = gql`
        query superQuery($id: ID!) {
          people_one(id: $id) {
            name
            age
          }
        }
      `;

      const superDataOne = {
        people_one: {
          name: 'Luke Skywalker',
          age: 21,
        },
      };

      const queryManager = mockQueryManager(
        reject,
        {
          request: { query, variables },
          result: { data: dataOne },
        },
        {
          request: { query: superQuery, variables },
          result: { data: superDataOne },
        },
      );

      queryManager.query({ query, variables }).then(result => {
        const observable = queryManager.watchQuery({
          query: superQuery,
          variables,
          returnPartialData: true,
        });

        expect(observable.getCurrentResult()).toEqual({
          data: dataOne,
          loading: true,
          networkStatus: 1,
          partial: true,
        });

        // we can use this to trigger the query
        subscribeAndCount(reject, observable, (handleCount, subResult) => {
          const { data, loading, networkStatus } = observable.getCurrentResult();

          expect(subResult.data).toEqual(data);
          expect(subResult.loading).toEqual(loading);
          expect(subResult.networkStatus).toEqual(networkStatus);

          if (handleCount === 1) {
            expect(subResult).toEqual({
              data: dataOne,
              loading: true,
              networkStatus: 1,
              partial: true,
            });

          } else if (handleCount === 2) {
            expect(subResult).toEqual({
              data: superDataOne,
              loading: false,
              networkStatus: 7,
            });
            resolve();
          }
        });
      });
    });

    itAsync('returns loading even if full data is available when using network-only fetchPolicy', (resolve, reject) => {
      const queryManager = mockQueryManager(
        reject,
        {
          request: { query, variables },
          result: { data: dataOne },
        },
        {
          request: { query, variables },
          result: { data: dataTwo },
        },
      );

      queryManager.query({ query, variables }).then(result => {
        expect(result).toEqual({
          data: dataOne,
          loading: false,
          networkStatus: NetworkStatus.ready,
        });

        const observable = queryManager.watchQuery({
          query,
          variables,
          fetchPolicy: 'network-only',
        });

        expect(observable.getCurrentResult()).toEqual({
          data: dataOne,
          loading: true,
          networkStatus: NetworkStatus.loading,
        });

        subscribeAndCount(reject, observable, (handleCount, subResult) => {
          if (handleCount === 1) {
            expect(subResult).toEqual({
              loading: true,
              data: dataOne,
              networkStatus: NetworkStatus.loading,
            });
          } else if (handleCount === 2) {
            expect(subResult).toEqual({
              data: dataTwo,
              loading: false,
              networkStatus: NetworkStatus.ready,
            });
            resolve();
          }
        });
      });
    });

    itAsync('returns loading on no-cache fetchPolicy queries when calling getCurrentResult', (resolve, reject) => {
      const queryManager = mockQueryManager(
        reject,
        {
          request: { query, variables },
          result: { data: dataOne },
        },
        {
          request: { query, variables },
          result: { data: dataTwo },
        },
      );

      queryManager.query({ query, variables }).then(() => {
        const observable = queryManager.watchQuery({
          query,
          variables,
          fetchPolicy: 'no-cache',
        });
        expect(stripSymbols(observable.getCurrentResult())).toEqual({
          data: undefined,
          loading: true,
          networkStatus: 1,
        });

        subscribeAndCount(reject, observable, (handleCount, subResult) => {
          const {
            data,
            loading,
            networkStatus,
          } = observable.getCurrentResult();

          if (handleCount === 1) {
            expect(subResult).toEqual({
              data,
              loading,
              networkStatus,
            });
          } else if (handleCount === 2) {
            expect(stripSymbols(subResult)).toEqual({
              data: dataTwo,
              loading: false,
              networkStatus: 7,
            });
            resolve();
          }
        });
      });
    });

    describe('mutations', () => {
      const mutation = gql`
        mutation setName {
          name
        }
      `;

      const mutationData = {
        name: 'Leia Skywalker',
      };

      const optimisticResponse = {
        name: 'Leia Skywalker (optimistic)',
      };

      const updateQueries = {
        query: (_: any, { mutationResult }: any) => {
          return {
            people_one: { name: mutationResult.data.name },
          };
        },
      };

      itAsync('returns optimistic mutation results from the store', (resolve, reject) => {
        const queryManager = mockQueryManager(
          reject,
          {
            request: { query, variables },
            result: { data: dataOne },
          },
          {
            request: { query: mutation },
            result: { data: mutationData },
          },
        );

        const observable = queryManager.watchQuery({
          query,
          variables,
        });

        subscribeAndCount(reject, observable, (count, result) => {
          const {
            data,
            loading,
            networkStatus,
          } = observable.getCurrentResult();
          expect(result).toEqual({
            data,
            loading,
            networkStatus,
          });

          if (count === 1) {
            expect(stripSymbols(result)).toEqual({
              data: dataOne,
              loading: false,
              networkStatus: 7,
            });
            queryManager.mutate({
              mutation,
              optimisticResponse,
              updateQueries,
            });
          } else if (count === 2) {
            expect(stripSymbols(result.data.people_one)).toEqual(
              optimisticResponse,
            );
          } else if (count === 3) {
            expect(stripSymbols(result.data.people_one)).toEqual(mutationData);
            resolve();
          }
        });
      });
    });
  });

  describe('assumeImmutableResults', () => {
    itAsync('should prevent costly (but safe) cloneDeep calls', async (resolve, reject) => {
      const queryOptions = {
        query: gql`
          query {
            value
          }
        `,
        pollInterval: 20,
      };

      function check({
        assumeImmutableResults = true,
        assertFrozenResults = false,
      }) {
        const cache = new InMemoryCache();
        const client = new ApolloClient({
          link: mockSingleLink(
            { request: queryOptions, result: { data: { value: 1 } } },
            { request: queryOptions, result: { data: { value: 2 } } },
            { request: queryOptions, result: { data: { value: 3 } } }
          ).setOnError(error => { throw error }),
          assumeImmutableResults,
          cache,
        });

        const observable = client.watchQuery(queryOptions);
        const values: any[] = [];

        return new Promise<any[]>((resolve, reject) => {
          observable.subscribe({
            next({ data }) {
              values.push(data.value);
              if (assertFrozenResults) {
                try {
                  data.value = 'oyez';
                } catch (error) {
                  reject(error);
                }
              } else {
                data = {
                  ...data,
                  value: 'oyez',
                };
              }
              client.writeQuery({
                query: queryOptions.query,
                data,
              });
            },
            error(err) {
              expect(err.message).toMatch(/No more mocked responses/);
              resolve(values);
            },
          });
        });
      }

      async function checkThrows(assumeImmutableResults: boolean) {
        try {
          await check({
            assumeImmutableResults,
            // No matter what value we provide for assumeImmutableResults, if we
            // tell the InMemoryCache to deep-freeze its results, destructive
            // modifications of the result objects will become fatal. Once you
            // start enforcing immutability in this way, you might as well pass
            // assumeImmutableResults: true, to prevent calling cloneDeep.
            assertFrozenResults: true,
          });
          throw new Error('not reached');
        } catch (error) {
          expect(error).toBeInstanceOf(TypeError);
          expect(error.message).toMatch(
            /Cannot assign to read only property 'value'/,
          );
        }
      }
      await checkThrows(true);
      await checkThrows(false);

      resolve();
    });
  });

  describe('resetQueryStoreErrors', () => {
    itAsync("should remove any GraphQLError's stored in the query store", (resolve, reject) => {
      const graphQLError = new GraphQLError('oh no!');

      const observable: ObservableQuery<any> = mockWatchQuery(reject, {
        request: { query, variables },
        result: { errors: [graphQLError] },
      });

      observable.subscribe({
        error() {
          const { queryManager } = (observable as any);
          const queryInfo = queryManager["queries"].get(observable.queryId);
          expect(queryInfo.graphQLErrors).toEqual([graphQLError]);

          observable.resetQueryStoreErrors();
          expect(queryInfo.graphQLErrors).toEqual([]);

          resolve();
        }
      });
    });

    itAsync("should remove network error's stored in the query store", (resolve, reject) => {
      const networkError = new Error('oh no!');

      const observable: ObservableQuery<any> = mockWatchQuery(reject, {
        request: { query, variables },
        result: { data: dataOne },
      });

      observable.subscribe({
        next() {
          const { queryManager } = (observable as any);
          const queryInfo = queryManager["queries"].get(observable.queryId);
          queryInfo.networkError = networkError;
          observable.resetQueryStoreErrors();
          expect(queryInfo.networkError).toBeUndefined();
          resolve();
        }
      });
    });
  });

  itAsync("QueryInfo does not notify for !== but deep-equal results", (resolve, reject) => {
    const queryManager = mockQueryManager(reject, {
      request: { query, variables },
      result: { data: dataOne },
    });

    const observable = queryManager.watchQuery({
      query,
      variables,
      // If we let the cache return canonical results, it will be harder to
      // write this test, because any two results that are deeply equal will
      // also be !==, making the choice of equality test in queryInfo.setDiff
      // less visible/important.
      canonizeResults: false,
    });

    const queryInfo = observable["queryInfo"];
    const cache = queryInfo["cache"];
    const setDiffSpy = jest.spyOn(queryInfo, "setDiff");
    const notifySpy = jest.spyOn(queryInfo, "notify");

    subscribeAndCount(reject, observable, (count, result) => {
      if (count === 1) {
        expect(result).toEqual({
          loading: false,
          networkStatus: NetworkStatus.ready,
          data: dataOne,
        });

        let invalidateCount = 0;
        let onWatchUpdatedCount = 0;

        cache.batch({
          optimistic: true,
          update(cache) {
            cache.modify({
              fields: {
                people_one(value, { INVALIDATE }) {
                  expect(value).toEqual(dataOne.people_one);
                  ++invalidateCount;
                  return INVALIDATE;
                },
              },
            });
          },
          // Verify that the cache.modify operation did trigger a cache broadcast.
          onWatchUpdated(watch, diff) {
            expect(watch.watcher).toBe(queryInfo);
            expect(diff).toEqual({
              complete: true,
              result: {
                people_one: {
                  name: "Luke Skywalker",
                },
              },
            });
            ++onWatchUpdatedCount;
          },
        });

        new Promise(resolve => setTimeout(resolve, 100)).then(() => {
          expect(setDiffSpy).toHaveBeenCalledTimes(1);
          expect(notifySpy).not.toHaveBeenCalled();
          expect(invalidateCount).toBe(1);
          expect(onWatchUpdatedCount).toBe(1);
          queryManager.stop();
        }).then(resolve, reject);
      } else {
        reject("too many results");
      }
    });
  });

  itAsync("ObservableQuery#map respects Symbol.species", (resolve, reject) => {
    const observable = mockWatchQuery(reject, {
      request: { query, variables },
      result: { data: dataOne },
    });
    expect(observable).toBeInstanceOf(Observable);
    expect(observable).toBeInstanceOf(ObservableQuery);

    const mapped = observable.map(result => {
      expect(result).toEqual({
        loading: false,
        networkStatus: NetworkStatus.ready,
        data: dataOne,
      });
      return {
        ...result,
        data: { mapped: true },
      };
    });
    expect(mapped).toBeInstanceOf(Observable);
    expect(mapped).not.toBeInstanceOf(ObservableQuery);

    const sub = mapped.subscribe({
      next(result) {
        sub.unsubscribe();
        try {
          expect(result).toEqual({
            loading: false,
            networkStatus: NetworkStatus.ready,
            data: { mapped: true },
          });
        } catch (error) {
          reject(error);
          return;
        }
        resolve();
      },
      error: reject,
    });
  });
});
