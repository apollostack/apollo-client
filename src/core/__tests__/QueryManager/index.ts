// externals
import { from } from 'rxjs';
import { map } from 'rxjs/operators';
import { assign } from 'lodash';
import gql from 'graphql-tag';
import { DocumentNode, GraphQLError } from 'graphql';
import { setVerbosity } from 'ts-invariant';

import { Observable, Observer } from '../../../utilities/observables/Observable';
import { ApolloLink, GraphQLRequest, FetchResult } from '../../../link/core';
import { InMemoryCache, InMemoryCacheConfig } from '../../../cache/inmemory/inMemoryCache';
import {
  ApolloReducerConfig,
  NormalizedCacheObject
} from '../../../cache/inmemory/types';

// mocks
import mockQueryManager from '../../../utilities/testing/mocking/mockQueryManager';
import mockWatchQuery from '../../../utilities/testing/mocking/mockWatchQuery';
import { MockApolloLink, mockSingleLink } from '../../../utilities/testing/mocking/mockLink';

// core
import { ApolloQueryResult } from '../../types';
import { NetworkStatus } from '../../networkStatus';
import { ObservableQuery } from '../../ObservableQuery';
import { MutationBaseOptions, MutationOptions, WatchQueryOptions } from '../../watchQueryOptions';
import { QueryManager } from '../../QueryManager';

import { ApolloError } from '../../../errors';

// testing utils
import wrap from '../../../utilities/testing/wrap';
import observableToPromise, {
  observableToPromiseAndSubscription,
} from '../../../utilities/testing/observableToPromise';
import subscribeAndCount from '../../../utilities/testing/subscribeAndCount';
import { stripSymbols } from '../../../utilities/testing/stripSymbols';
import { itAsync } from '../../../utilities/testing/itAsync';
import { ApolloClient } from '../../../core'
import { mockFetchQuery } from '../ObservableQuery';

interface MockedMutation {
  reject: (reason: any) => any;
  mutation: DocumentNode;
  data?: Object;
  errors?: GraphQLError[];
  variables?: Object;
  config?: ApolloReducerConfig;
}

describe('QueryManager', () => {
  // Standard "get id from object" method.
  const dataIdFromObject = (object: any) => {
    if (object.__typename && object.id) {
      return object.__typename + '__' + object.id;
    }
    return undefined;
  };

  // Helper method that serves as the constructor method for
  // QueryManager but has defaults that make sense for these
  // tests.
  const createQueryManager = ({
    link,
    config = {},
    clientAwareness = {},
    queryDeduplication = false,
  }: {
    link: ApolloLink;
    config?: Partial<InMemoryCacheConfig>;
    clientAwareness?: { [key: string]: string };
    queryDeduplication?: boolean;
  }) => {
    return new QueryManager({
      link,
      cache: new InMemoryCache({ addTypename: false, ...config }),
      clientAwareness,
      queryDeduplication,
      // Enable client.queryManager.mutationStore tracking.
      onBroadcast() {},
    });
  };

  // Helper method that sets up a mockQueryManager and then passes on the
  // results to an observer.
  const assertWithObserver = ({
    reject,
    query,
    variables = {},
    queryOptions = {},
    result,
    error,
    delay,
    observer,
  }: {
    reject: (reason: any) => any;
    query: DocumentNode;
    variables?: Object;
    queryOptions?: Object;
    error?: Error;
    result?: FetchResult;
    delay?: number;
    observer: Observer<ApolloQueryResult<any>>;
  }) => {
    const queryManager = mockQueryManager(reject, {
      request: { query, variables },
      result,
      error,
      delay,
    });
    const finalOptions = assign(
      { query, variables },
      queryOptions,
    ) as WatchQueryOptions;
    return queryManager.watchQuery<any>(finalOptions).subscribe({
      next: wrap(reject, observer.next!),
      error: observer.error,
    });
  };

  const mockMutation = ({
    reject,
    mutation,
    data,
    errors,
    variables = {},
    config = {},
  }: MockedMutation) => {
    const link = mockSingleLink({
      request: { query: mutation, variables },
      result: { data, errors },
    }).setOnError(reject);

    const queryManager = createQueryManager({
      link,
      config,
    });

    return new Promise<{
      result: FetchResult;
      queryManager: QueryManager<NormalizedCacheObject>;
    }>((resolve, reject) => {
      queryManager
        .mutate({ mutation, variables })
        .then((result: any) => {
          resolve({ result, queryManager });
        })
        .catch(error => {
          reject(error);
        });
    });
  };

  const assertMutationRoundtrip = (
      resolve: (result: any) => any,
      opts: MockedMutation) => {
    const { reject } = opts;
    return mockMutation(opts).then(({ result }) => {
      expect(stripSymbols(result.data)).toEqual(opts.data);
    }).then(resolve, reject);
  };

  // Helper method that takes a query with a first response and a second response.
  // Used to assert stuff about refetches.
  const mockRefetch = ({
    reject,
    request,
    firstResult,
    secondResult,
    thirdResult,
  }: {
    reject: (reason: any) => any;
    request: GraphQLRequest;
    firstResult: FetchResult;
    secondResult: FetchResult;
    thirdResult?: FetchResult;
  }) => {
    const args = [
      {
        request,
        result: firstResult,
      },
      {
        request,
        result: secondResult,
      },
    ];

    if (thirdResult) {
      args.push({ request, result: thirdResult });
    }

    return mockQueryManager(reject, ...args);
  };

  function getCurrentQueryResult<TData, TVars>(
    observableQuery: ObservableQuery<TData, TVars>,
  ): {
    data?: TData;
    partial: boolean;
  } {
    const result = observableQuery.getCurrentResult();
    return {
      data: result.data,
      partial: !!result.partial,
    };
  }

  itAsync('handles GraphQL errors', (resolve, reject) => {
    assertWithObserver({
      reject,
      query: gql`
        query people {
          allPeople(first: 1) {
            people {
              name
            }
          }
        }
      `,
      variables: {},
      result: {
        errors: [
          new GraphQLError('This is an error message.'),
        ],
      },
      observer: {
        next() {
          reject(
            new Error('Returned a result when it was supposed to error out'),
          );
        },

        error(apolloError) {
          expect(apolloError).toBeDefined();
          resolve();
        },
      },
    });
  });

  itAsync('handles GraphQL errors as data', (resolve, reject) => {
    assertWithObserver({
      reject,
      query: gql`
        query people {
          allPeople(first: 1) {
            people {
              name
            }
          }
        }
      `,
      variables: {},
      queryOptions: {
        errorPolicy: 'all',
      },
      result: {
        errors: [
          new GraphQLError('This is an error message.'),
        ],
      },
      observer: {
        next({ errors }) {
          expect(errors).toBeDefined();
          expect(errors![0].message).toBe('This is an error message.');
          resolve();
        },
        error(apolloError) {
          reject(new Error(
            'Called observer.error instead of passing errors to observer.next',
          ));
        },
      },
    });
  });

  itAsync('handles GraphQL errors with data returned', (resolve, reject) => {
    assertWithObserver({
      reject,
      query: gql`
        query people {
          allPeople(first: 1) {
            people {
              name
            }
          }
        }
      `,
      result: {
        data: {
          allPeople: {
            people: {
              name: 'Ada Lovelace',
            },
          },
        },
        errors: [
          new GraphQLError('This is an error message.'),
        ],
      },
      observer: {
        next() {
          reject(
            new Error('Returned data when it was supposed to error out.'),
          );
        },

        error(apolloError) {
          expect(apolloError).toBeDefined();
          resolve();
        },
      },
    });
  });

  itAsync('empty error array (handle non-spec-compliant server) #156', (resolve, reject) => {
    assertWithObserver({
      reject,
      query: gql`
        query people {
          allPeople(first: 1) {
            people {
              name
            }
          }
        }
      `,
      result: {
        data: {
          allPeople: {
            people: {
              name: 'Ada Lovelace',
            },
          },
        },
        errors: [],
      },
      observer: {
        next(result) {
          expect(result.data['allPeople'].people.name).toBe('Ada Lovelace');
          expect(result['errors']).toBeUndefined();
          resolve();
        },
      },
    });
  });

  // Easy to get into this state if you write an incorrect `formatError`
  // function with graphql-server or express-graphql
  itAsync('error array with nulls (handle non-spec-compliant server) #1185', (resolve, reject) => {
    assertWithObserver({
      reject,
      query: gql`
        query people {
          allPeople(first: 1) {
            people {
              name
            }
          }
        }
      `,
      result: {
        errors: [null as any],
      },
      observer: {
        next() {
          reject(new Error('Should not fire next for an error'));
        },
        error(error) {
          expect((error as any).graphQLErrors).toEqual([null]);
          expect(error.message).toBe('Error message not found.');
          resolve();
        },
      },
    });
  });

  itAsync('handles network errors', (resolve, reject) => {
    assertWithObserver({
      reject,
      query: gql`
        query people {
          allPeople(first: 1) {
            people {
              name
            }
          }
        }
      `,
      error: new Error('Network error'),
      observer: {
        next: () => {
          reject(new Error('Should not deliver result'));
        },
        error: error => {
          const apolloError = error as ApolloError;
          expect(apolloError.networkError).toBeDefined();
          expect(apolloError.networkError!.message).toMatch('Network error');
          resolve();
        },
      },
    });
  });

  itAsync('uses console.error to log unhandled errors', (resolve, reject) => {
    const oldError = console.error;
    let printed: any;
    console.error = (...args: any[]) => {
      printed = args;
    };

    assertWithObserver({
      reject,
      query: gql`
        query people {
          allPeople(first: 1) {
            people {
              name
            }
          }
        }
      `,
      error: new Error('Network error'),
      observer: {
        next: () => {
          reject(new Error('Should not deliver result'));
        },
      },
    });

    setTimeout(() => {
      expect(printed[0]).toMatch(/error/);
      console.error = oldError;
      resolve();
    }, 10);
  });

  // XXX this looks like a bug in zen-observable but we should figure
  // out a solution for it
  itAsync.skip('handles an unsubscribe action that happens before data returns', (resolve, reject) => {
    const subscription = assertWithObserver({
      reject,
      query: gql`
        query people {
          allPeople(first: 1) {
            people {
              name
            }
          }
        }
      `,
      delay: 1000,
      observer: {
        next: () => {
          reject(new Error('Should not deliver result'));
        },
        error: () => {
          reject(new Error('Should not deliver result'));
        },
      },
    });

    expect(subscription.unsubscribe).not.toThrow();
  });

  // Query should be aborted on last .unsubscribe()
  itAsync('causes link unsubscription if unsubscribed', (resolve, reject) => {
    const expResult = {
      data: {
        allPeople: {
          people: [
            {
              name: 'Luke Skywalker',
            },
          ],
        },
      },
    };

    const request = {
      query: gql`
        query people {
          allPeople(first: 1) {
            people {
              name
            }
          }
        }
      `,
      variables: undefined
    };

    const mockedResponse = {
      request,
      result: expResult
    };

    const onRequestSubscribe = jest.fn();
    const onRequestUnsubscribe = jest.fn();

    const mockedSingleLink = new ApolloLink(() => {
      return new Observable(observer => {
        onRequestSubscribe();

        const timer = setTimeout(() => {
          observer.next(mockedResponse.result);
          observer.complete();
        }, 0);

        return () => {
          onRequestUnsubscribe();
          clearTimeout(timer);
        };
      });
    });

    const mockedQueryManger = new QueryManager({
      link: mockedSingleLink,
      cache: new InMemoryCache({ addTypename: false }),
    });

    const observableQuery = mockedQueryManger.watchQuery({
      query: request.query,
      variables: request.variables,
      notifyOnNetworkStatusChange: false
    });

    const observerCallback = wrap(reject, () => {
      reject(new Error('Link subscription should have been cancelled'));
    });

    const subscription = observableQuery.subscribe({
      next: observerCallback,
      error: observerCallback,
      complete: observerCallback
    });

    subscription.unsubscribe();

    return new Promise(
      // Unsubscribing from the link happens after a microtask
      // (Promise.resolve().then) delay, so we need to wait at least that
      // long before verifying onRequestUnsubscribe was called.
      resolve => setTimeout(resolve, 0)
    ).then(() => {
      expect(onRequestSubscribe).toHaveBeenCalledTimes(1);
      expect(onRequestUnsubscribe).toHaveBeenCalledTimes(1);
    }).then(resolve, reject);
  });

  itAsync('supports interoperability with other Observable implementations like RxJS', (resolve, reject) => {
    const expResult = {
      data: {
        allPeople: {
          people: [
            {
              name: 'Luke Skywalker',
            },
          ],
        },
      },
    };

    const handle = mockWatchQuery(reject, {
      request: {
        query: gql`
          query people {
            allPeople(first: 1) {
              people {
                name
              }
            }
          }
        `,
      },
      result: expResult,
    });

    const observable = from(handle as any);

    observable.pipe(map(result => assign({ fromRx: true }, result))).subscribe({
      next: wrap(reject, newResult => {
        const expectedResult = assign(
          { fromRx: true, loading: false, networkStatus: 7 },
          expResult,
        );
        expect(stripSymbols(newResult)).toEqual(expectedResult);
        resolve();
      }),
    });
  });

  itAsync('allows you to subscribe twice to one query', (resolve, reject) => {
    const request = {
      query: gql`
        query fetchLuke($id: String) {
          people_one(id: $id) {
            name
          }
        }
      `,
      variables: {
        id: '1',
      },
    };
    const data1 = {
      people_one: {
        name: 'Luke Skywalker',
      },
    };

    const data2 = {
      people_one: {
        name: 'Luke Skywalker has a new name',
      },
    };

    const data3 = {
      people_one: {
        name: 'Luke Skywalker has another name',
      },
    };

    const queryManager = mockQueryManager(
      reject,
      {
        request,
        result: { data: data1 },
      },
      {
        request,
        result: { data: data2 },

        // Wait for both to subscribe
        delay: 100,
      },
      {
        request,
        result: { data: data3 },
      },
    );

    let subOneCount = 0;

    // pre populate data to avoid contention
    queryManager.query<any>(request).then(() => {
      const handle = queryManager.watchQuery<any>(request);

      const subOne = handle.subscribe({
        next(result) {
          subOneCount++;

          if (subOneCount === 1) {
            expect(stripSymbols(result.data)).toEqual(data1);
          } else if (subOneCount === 2) {
            expect(stripSymbols(result.data)).toEqual(data2);
          }
        },
      });

      let subTwoCount = 0;
      handle.subscribe({
        next(result) {
          subTwoCount++;
          if (subTwoCount === 1) {
            expect(stripSymbols(result.data)).toEqual(data1);
            handle.refetch();
          } else if (subTwoCount === 2) {
            expect(stripSymbols(result.data)).toEqual(data2);
            setTimeout(() => {
              try {
                expect(subOneCount).toBe(2);

                subOne.unsubscribe();
                handle.refetch();
              } catch (e) {
                reject(e);
              }
            }, 0);
          } else if (subTwoCount === 3) {
            setTimeout(() => {
              try {
                expect(subOneCount).toBe(2);
                resolve();
              } catch (e) {
                reject(e);
              }
            }, 0);
          }
        },
      });
    });
  });

  itAsync('resolves all queries when one finishes after another', (resolve, reject) => {
    const request = {
      query: gql`
        query fetchLuke($id: String) {
          people_one(id: $id) {
            name
          }
        }
      `,
      variables: {
        id: '1',
      },
      notifyOnNetworkStatusChange: true,
    };
    const request2 = {
      query: gql`
        query fetchLeia($id: String) {
          people_one(id: $id) {
            name
          }
        }
      `,
      variables: {
        id: '2',
      },
      notifyOnNetworkStatusChange: true,
    };
    const request3 = {
      query: gql`
        query fetchHan($id: String) {
          people_one(id: $id) {
            name
          }
        }
      `,
      variables: {
        id: '3',
      },
      notifyOnNetworkStatusChange: true,
    };

    const data1 = {
      people_one: {
        name: 'Luke Skywalker',
      },
    };
    const data2 = {
      people_one: {
        name: 'Leia Skywalker',
      },
    };
    const data3 = {
      people_one: {
        name: 'Han Solo',
      },
    };

    const queryManager = mockQueryManager(
      reject,
      {
        request,
        result: { data: data1 },
        delay: 10,
      },
      {
        request: request2,
        result: { data: data2 },
        // make the second request the slower one
        delay: 100,
      },
      {
        request: request3,
        result: { data: data3 },
        delay: 10,
      },
    );

    const ob1 = queryManager.watchQuery(request);
    const ob2 = queryManager.watchQuery(request2);
    const ob3 = queryManager.watchQuery(request3);

    let finishCount = 0;
    ob1.subscribe(result => {
      expect(stripSymbols(result.data)).toEqual(data1);
      finishCount++;
    });
    ob2.subscribe(result => {
      expect(stripSymbols(result.data)).toEqual(data2);
      expect(finishCount).toBe(2);
      resolve();
    });
    ob3.subscribe(result => {
      expect(stripSymbols(result.data)).toEqual(data3);
      finishCount++;
    });
  });

  itAsync('allows you to refetch queries', (resolve, reject) => {
    const request = {
      query: gql`
        query fetchLuke($id: String) {
          people_one(id: $id) {
            name
          }
        }
      `,
      variables: {
        id: '1',
      },
      notifyOnNetworkStatusChange: false,
    };
    const data1 = {
      people_one: {
        name: 'Luke Skywalker',
      },
    };

    const data2 = {
      people_one: {
        name: 'Luke Skywalker has a new name',
      },
    };

    const queryManager = mockRefetch({
      reject,
      request,
      firstResult: { data: data1 },
      secondResult: { data: data2 },
    });

    const observable = queryManager.watchQuery<any>(request);
    return observableToPromise(
      { observable },
      result => {
        expect(stripSymbols(result.data)).toEqual(data1);
        observable.refetch();
      },
      result => expect(stripSymbols(result.data)).toEqual(data2),
    ).then(resolve, reject);
  });

  itAsync('will return referentially equivalent data if nothing changed in a refetch', (resolve, reject) => {
    const request = {
      query: gql`
        {
          a
          b {
            c
          }
          d {
            e
            f {
              g
            }
          }
        }
      `,
      notifyOnNetworkStatusChange: false,
    };

    const data1 = {
      a: 1,
      b: { c: 2 },
      d: { e: 3, f: { g: 4 } },
    };

    const data2 = {
      a: 1,
      b: { c: 2 },
      d: { e: 30, f: { g: 4 } },
    };

    const data3 = {
      a: 1,
      b: { c: 2 },
      d: { e: 3, f: { g: 4 } },
    };

    const queryManager = mockRefetch({
      reject,
      request,
      firstResult: { data: data1 },
      secondResult: { data: data2 },
      thirdResult: { data: data3 },
    });

    const observable = queryManager.watchQuery<any>(request);

    let count = 0;
    let firstResultData: any;

    observable.subscribe({
      next: result => {
        try {
          switch (count++) {
            case 0:
              expect(stripSymbols(result.data)).toEqual(data1);
              firstResultData = result.data;
              observable.refetch();
              break;
            case 1:
              expect(stripSymbols(result.data)).toEqual(data2);
              expect(result.data).not.toEqual(firstResultData);
              expect(result.data.b).toEqual(firstResultData.b);
              expect(result.data.d).not.toEqual(firstResultData.d);
              expect(result.data.d.f).toEqual(firstResultData.d.f);
              observable.refetch();
              break;
            case 2:
              expect(stripSymbols(result.data)).toEqual(data3);
              expect(result.data).toBe(firstResultData);
              resolve();
              break;
            default:
              throw new Error('Next run too many times.');
          }
        } catch (error) {
          reject(error);
        }
      },
      error: reject,
    });
  });

  itAsync('will return referentially equivalent data in getCurrentResult if nothing changed', (resolve, reject) => {
    const request = {
      query: gql`
        {
          a
          b {
            c
          }
          d {
            e
            f {
              g
            }
          }
        }
      `,
      notifyOnNetworkStatusChange: false,
    };

    const data1 = {
      a: 1,
      b: { c: 2 },
      d: { e: 3, f: { g: 4 } },
    };

    const queryManager = mockQueryManager(reject, {
      request,
      result: { data: data1 },
    });

    const observable = queryManager.watchQuery<any>(request);

    observable.subscribe({
      next: result => {
        try {
          expect(stripSymbols(result.data)).toEqual(data1);
          expect(stripSymbols(result.data)).toEqual(
            stripSymbols(observable.getCurrentResult().data),
          );
          resolve();
        } catch (error) {
          reject(error);
        }
      },
      error: reject,
    });
  });

  itAsync('sets networkStatus to `refetch` when refetching', (resolve, reject) => {
    const request: WatchQueryOptions = {
      query: gql`
        query fetchLuke($id: String) {
          people_one(id: $id) {
            name
          }
        }
      `,
      variables: {
        id: '1',
      },
      notifyOnNetworkStatusChange: true,
      // This causes a loading:true result to be delivered from the cache
      // before the final data2 result is delivered.
      fetchPolicy: "cache-and-network",
    };
    const data1 = {
      people_one: {
        name: 'Luke Skywalker',
      },
    };

    const data2 = {
      people_one: {
        name: 'Luke Skywalker has a new name',
      },
    };

    const queryManager = mockRefetch({
      reject,
      request,
      firstResult: { data: data1 },
      secondResult: { data: data2 },
    });

    const observable = queryManager.watchQuery<any>(request);
    return observableToPromise(
      { observable },
      result => {
        expect(stripSymbols(result.data)).toEqual(data1);
        observable.refetch();
      },
      result => expect(result.networkStatus).toBe(NetworkStatus.refetch),
      result => {
        expect(result.networkStatus).toBe(NetworkStatus.ready);
        expect(stripSymbols(result.data)).toEqual(data2);
      },
    ).then(resolve, reject);
  });

  itAsync('allows you to refetch queries with promises', async (resolve, reject) => {
    const request = {
      query: gql`
        {
          people_one(id: 1) {
            name
          }
        }
      `,
    };
    const data1 = {
      people_one: {
        name: 'Luke Skywalker',
      },
    };

    const data2 = {
      people_one: {
        name: 'Luke Skywalker has a new name',
      },
    };

    const queryManager = mockRefetch({
      reject,
      request,
      firstResult: { data: data1 },
      secondResult: { data: data2 },
    });

    const handle = queryManager.watchQuery<any>(request);
    handle.subscribe({});

    return handle
      .refetch()
      .then(result => expect(stripSymbols(result.data)).toEqual(data2))
      .then(resolve, reject);
  });

  itAsync('allows you to refetch queries with new variables', (resolve, reject) => {
    const query = gql`
      {
        people_one(id: 1) {
          name
        }
      }
    `;

    const data1 = {
      people_one: {
        name: 'Luke Skywalker',
      },
    };

    const data2 = {
      people_one: {
        name: 'Luke Skywalker has a new name',
      },
    };

    const data3 = {
      people_one: {
        name: 'Luke Skywalker has a new name and age',
      },
    };

    const data4 = {
      people_one: {
        name: 'Luke Skywalker has a whole new bag',
      },
    };

    const variables1 = {
      test: 'I am your father',
    };

    const variables2 = {
      test: "No. No! That's not true! That's impossible!",
    };

    const queryManager = mockQueryManager(
      reject,
      {
        request: { query: query },
        result: { data: data1 },
      },
      {
        request: { query: query },
        result: { data: data2 },
      },
      {
        request: { query: query, variables: variables1 },
        result: { data: data3 },
      },
      {
        request: { query: query, variables: variables2 },
        result: { data: data4 },
      },
    );

    const observable = queryManager.watchQuery<any>({
      query,
      notifyOnNetworkStatusChange: false,
    });
    return observableToPromise(
      { observable },
      result => {
        expect(result.loading).toBe(false);
        expect(result.data).toEqual(data1);
        return observable.refetch();
      },
      result => {
        expect(result.loading).toBe(false);
        expect(result.data).toEqual(data2);
        return observable.refetch(variables1);
      },
      result => {
        expect(result.loading).toBe(false);
        expect(result.data).toEqual(data3);
        return observable.refetch(variables2);
      },
      result => {
        expect(result.loading).toBe(false);
        expect(result.data).toEqual(data4);
      },
    ).then(resolve, reject);
  });

  itAsync('only modifies varaibles when refetching', (resolve, reject) => {
    const query = gql`
      {
        people_one(id: 1) {
          name
        }
      }
    `;

    const data1 = {
      people_one: {
        name: 'Luke Skywalker',
      },
    };

    const data2 = {
      people_one: {
        name: 'Luke Skywalker has a new name',
      },
    };

    const queryManager = mockQueryManager(
      reject,
      {
        request: { query: query },
        result: { data: data1 },
      },
      {
        request: { query: query },
        result: { data: data2 },
      },
    );

    const observable = queryManager.watchQuery<any>({
      query,
      notifyOnNetworkStatusChange: false,
    });
    const originalOptions = assign({}, observable.options);
    return observableToPromise(
      { observable },
      result => {
        expect(stripSymbols(result.data)).toEqual(data1);
        observable.refetch();
      },
      result => {
        expect(stripSymbols(result.data)).toEqual(data2);
        const updatedOptions = assign({}, observable.options);
        delete originalOptions.variables;
        delete updatedOptions.variables;
        expect(updatedOptions).toEqual(originalOptions);
      },
    ).then(resolve, reject);
  });

  itAsync('continues to poll after refetch', (resolve, reject) => {
    const query = gql`
      {
        people_one(id: 1) {
          name
        }
      }
    `;

    const data1 = {
      people_one: {
        name: 'Luke Skywalker',
      },
    };

    const data2 = {
      people_one: {
        name: 'Luke Skywalker has a new name',
      },
    };

    const data3 = {
      people_one: {
        name: 'Patsy',
      },
    };

    const queryManager = mockQueryManager(
      reject,
      {
        request: { query },
        result: { data: data1 },
      },
      {
        request: { query },
        result: { data: data2 },
      },
      {
        request: { query },
        result: { data: data3 },
      },
    );

    const observable = queryManager.watchQuery<any>({
      query,
      pollInterval: 200,
      notifyOnNetworkStatusChange: false,
    });

    return observableToPromise(
      { observable },
      result => {
        expect(stripSymbols(result.data)).toEqual(data1);
        observable.refetch();
      },
      result => expect(stripSymbols(result.data)).toEqual(data2),
      result => {
        expect(stripSymbols(result.data)).toEqual(data3);
        observable.stopPolling();
      },
    ).then(resolve, reject);
  });

  itAsync('sets networkStatus to `poll` if a polling query is in flight', (resolve, reject) => {
    const query = gql`
      {
        people_one(id: 1) {
          name
        }
      }
    `;

    const data1 = {
      people_one: {
        name: 'Luke Skywalker',
      },
    };

    const data2 = {
      people_one: {
        name: 'Luke Skywalker has a new name',
      },
    };

    const data3 = {
      people_one: {
        name: 'Patsy',
      },
    };

    const queryManager = mockQueryManager(
      reject,
      {
        request: { query },
        result: { data: data1 },
      },
      {
        request: { query },
        result: { data: data2 },
      },
      {
        request: { query },
        result: { data: data3 },
      },
    );

    const observable = queryManager.watchQuery<any>({
      query,
      pollInterval: 30,
      notifyOnNetworkStatusChange: true,
    });

    let counter = 0;
    const handle = observable.subscribe({
      next(result) {
        counter += 1;

        if (counter === 1) {
          expect(result.networkStatus).toBe(NetworkStatus.ready);
        } else if (counter === 2) {
          expect(result.networkStatus).toBe(NetworkStatus.poll);
          handle.unsubscribe();
          resolve();
        }
      },
    });
  });

  itAsync('can handle null values in arrays (#1551)', (resolve, reject) => {
    const query = gql`
      {
        list {
          value
        }
      }
    `;
    const data = { list: [null, { value: 1 }] };
    const queryManager = mockQueryManager(reject, {
      request: { query },
      result: { data },
    });
    const observable = queryManager.watchQuery({ query });

    observable.subscribe({
      next: result => {
        expect(stripSymbols(result.data)).toEqual(data);
        expect(stripSymbols(observable.getCurrentResult().data)).toEqual(data);
        resolve();
      },
    });
  });

  itAsync('supports cache-only fetchPolicy fetching only cached data', (resolve, reject) => {
    const primeQuery = gql`
      query primeQuery {
        luke: people_one(id: 1) {
          name
        }
      }
    `;

    const complexQuery = gql`
      query complexQuery {
        luke: people_one(id: 1) {
          name
        }
        vader: people_one(id: 4) {
          name
        }
      }
    `;

    const data1 = {
      luke: {
        name: 'Luke Skywalker',
      },
    };

    const queryManager = mockQueryManager(reject, {
      request: { query: primeQuery },
      result: { data: data1 },
    });

    // First, prime the cache
    return queryManager
      .query<any>({
        query: primeQuery,
      })
      .then(() => {
        const handle = queryManager.watchQuery<any>({
          query: complexQuery,
          fetchPolicy: 'cache-only',
        });

        return handle.result().then(result => {
          expect(result.data['luke'].name).toBe('Luke Skywalker');
          expect(result.data).not.toHaveProperty('vader');
        });
      })
      .then(resolve, reject);
  });

  itAsync('runs a mutation', (resolve, reject) => {
    return assertMutationRoundtrip(
      resolve,
        {
      reject,
      mutation: gql`
        mutation makeListPrivate {
          makeListPrivate(id: "5")
        }
      `,
      data: { makeListPrivate: true },
        }
    );
  });

  itAsync('runs a mutation even when errors is empty array #2912', (resolve, reject) => {
    return assertMutationRoundtrip(
      resolve,
        {
      reject,
      mutation: gql`
        mutation makeListPrivate {
          makeListPrivate(id: "5")
        }
      `,
          errors: [],
      data: { makeListPrivate: true },
        }
    );
  });

  itAsync('runs a mutation with default errorPolicy equal to "none"', (resolve, reject) => {
    const errors = [new GraphQLError('foo')];

    return mockMutation({
      reject,
      mutation: gql`
        mutation makeListPrivate {
          makeListPrivate(id: "5")
        }
      `,
      errors,
    }).then(
      result => {
        throw new Error(
          'Mutation should not be successful with default errorPolicy',
        );
      },
      error => {
        expect(error.graphQLErrors).toEqual(errors);
      },
    ).then(resolve, reject);
  });

  itAsync('runs a mutation with variables', (resolve, reject) => {
    return assertMutationRoundtrip(
      resolve,
        {
      reject,
      mutation: gql`
        mutation makeListPrivate($listId: ID!) {
          makeListPrivate(id: $listId)
        }
      `,
      variables: { listId: '1' },
      data: { makeListPrivate: true },
        },
    );
  });

  const getIdField = ({ id }: { id: string }) => id;

  itAsync('runs a mutation with object parameters and puts the result in the store', (resolve, reject) => {
    const data = {
      makeListPrivate: {
        id: '5',
        isPrivate: true,
      },
    };
    return mockMutation({
      reject,
      mutation: gql`
        mutation makeListPrivate {
          makeListPrivate(input: { id: "5" }) {
            id
            isPrivate
          }
        }
      `,
      data,
      config: { dataIdFromObject: getIdField },
    }).then(({ result, queryManager }) => {
      expect(stripSymbols(result.data)).toEqual(data);

      // Make sure we updated the store with the new data
      expect(
        queryManager.cache.extract()['5'],
      ).toEqual({
        id: '5',
        isPrivate: true,
      });
    }).then(resolve, reject);
  });

  itAsync('runs a mutation and puts the result in the store', (resolve, reject) => {
    const data = {
      makeListPrivate: {
        id: '5',
        isPrivate: true,
      },
    };

    return mockMutation({
      reject,
      mutation: gql`
        mutation makeListPrivate {
          makeListPrivate(id: "5") {
            id
            isPrivate
          }
        }
      `,
      data,
      config: { dataIdFromObject: getIdField },
    }).then(({ result, queryManager }) => {
      expect(stripSymbols(result.data)).toEqual(data);

      // Make sure we updated the store with the new data
      expect(
        queryManager.cache.extract()['5'],
      ).toEqual({
        id: '5',
        isPrivate: true,
      });
    }).then(resolve, reject);
  });

  itAsync('runs a mutation and puts the result in the store with root key', (resolve, reject) => {
    const mutation = gql`
      mutation makeListPrivate {
        makeListPrivate(id: "5") {
          id
          isPrivate
        }
      }
    `;

    const data = {
      makeListPrivate: {
        id: '5',
        isPrivate: true,
      },
    };

    const queryManager = createQueryManager({
      link: mockSingleLink({
        request: { query: mutation },
        result: { data },
      }).setOnError(reject),
      config: { dataIdFromObject: getIdField },
    });

    return queryManager
      .mutate({
        mutation,
      })
      .then(result => {
        expect(stripSymbols(result.data)).toEqual(data);

        // Make sure we updated the store with the new data
        expect(
          queryManager.cache.extract()['5'],
        ).toEqual({
          id: '5',
          isPrivate: true,
        });
      }).then(resolve, reject);
  });

  itAsync(`doesn't return data while query is loading`, (resolve, reject) => {
    const query1 = gql`
      {
        people_one(id: 1) {
          name
        }
      }
    `;

    const data1 = {
      people_one: {
        name: 'Luke Skywalker',
      },
    };

    const query2 = gql`
      {
        people_one(id: 5) {
          name
        }
      }
    `;

    const data2 = {
      people_one: {
        name: 'Darth Vader',
      },
    };

    const queryManager = mockQueryManager(
      reject,
      {
        request: { query: query1 },
        result: { data: data1 },
        delay: 10,
      },
      {
        request: { query: query2 },
        result: { data: data2 },
      },
    );

    const observable1 = queryManager.watchQuery<any>({ query: query1 });
    const observable2 = queryManager.watchQuery<any>({ query: query2 });

    return Promise.all([
      observableToPromise({ observable: observable1 }, result =>
        expect(stripSymbols(result.data)).toEqual(data1),
      ),
      observableToPromise({ observable: observable2 }, result =>
        expect(stripSymbols(result.data)).toEqual(data2),
      ),
    ]).then(resolve, reject);
  });

  itAsync('updates result of previous query if the result of a new query overlaps', (resolve, reject) => {
    const query1 = gql`
      {
        people_one(id: 1) {
          __typename
          id
          name
          age
        }
      }
    `;

    const data1 = {
      people_one: {
        // Correctly identifying this entity is necessary so that fields
        // from query1 and query2 can be safely merged in the cache.
        __typename: "Human",
        id: 1,
        name: 'Luke Skywalker',
        age: 50,
      },
    };

    const query2 = gql`
      {
        people_one(id: 1) {
          __typename
          id
          name
          username
        }
      }
    `;

    const data2 = {
      people_one: {
        __typename: "Human",
        id: 1,
        name: 'Luke Skywalker has a new name',
        username: 'luke',
      },
    };

    const queryManager = mockQueryManager(
      reject,
      {
        request: { query: query1 },
        result: { data: data1 },
      },
      {
        request: { query: query2 },
        result: { data: data2 },
        delay: 10,
      },
    );

    const observable = queryManager.watchQuery<any>({ query: query1 });

    subscribeAndCount(reject, observable, (handleCount, result) => {
      if (handleCount === 1) {
        expect(result.data).toEqual(data1);
        queryManager.query<any>({ query: query2 });
      } else if (handleCount === 2) {
        expect(result.data).toEqual({
          people_one: {
            __typename: "Human",
            id: 1,
            name: 'Luke Skywalker has a new name',
            age: 50,
          },
        });
        resolve();
      }
    });
  });

  itAsync('warns if you forget the template literal tag', async (resolve, reject) => {
    const queryManager = mockQueryManager(reject);
    expect(() => {
      queryManager.query<any>({
        // Bamboozle TypeScript into letting us do this
        query: ('string' as any) as DocumentNode,
      });
    }).toThrowError(/wrap the query string in a "gql" tag/);

    await expect(
      queryManager.mutate({
        // Bamboozle TypeScript into letting us do this
        mutation: ('string' as any) as DocumentNode,
      }),
    ).rejects.toThrow(/wrap the query string in a "gql" tag/);

    expect(() => {
      queryManager.watchQuery<any>({
        // Bamboozle TypeScript into letting us do this
        query: ('string' as any) as DocumentNode,
      });
    }).toThrowError(/wrap the query string in a "gql" tag/);

    resolve();
  });

  itAsync('should transform queries correctly when given a QueryTransformer', (resolve, reject) => {
    const query = gql`
      query {
        author {
          firstName
          lastName
        }
      }
    `;
    const transformedQuery = gql`
      query {
        author {
          firstName
          lastName
          __typename
        }
      }
    `;

    const transformedQueryResult = {
      author: {
        firstName: 'John',
        lastName: 'Smith',
        __typename: 'Author',
      },
    };

    //make sure that the query is transformed within the query
    //manager
    createQueryManager({
      link: mockSingleLink({
        request: { query: transformedQuery },
        result: { data: transformedQueryResult },
      }).setOnError(reject),
      config: { addTypename: true },
    })
      .query({ query: query })
      .then(result => {
        expect(stripSymbols(result.data)).toEqual(transformedQueryResult);
      })
      .then(resolve, reject);
  });

  itAsync('should transform mutations correctly', (resolve, reject) => {
    const mutation = gql`
      mutation {
        createAuthor(firstName: "John", lastName: "Smith") {
          firstName
          lastName
        }
      }
    `;
    const transformedMutation = gql`
      mutation {
        createAuthor(firstName: "John", lastName: "Smith") {
          firstName
          lastName
          __typename
        }
      }
    `;

    const transformedMutationResult = {
      createAuthor: {
        firstName: 'It works!',
        lastName: 'It works!',
        __typename: 'Author',
      },
    };

    createQueryManager({
      link: mockSingleLink({
        request: { query: transformedMutation },
        result: { data: transformedMutationResult },
      }).setOnError(reject),
      config: { addTypename: true },
    })
      .mutate({ mutation: mutation })
      .then(result => {
        expect(stripSymbols(result.data)).toEqual(transformedMutationResult);
        resolve();
      });
  });

  itAsync('should reject a query promise given a network error', (resolve, reject) => {
    const query = gql`
      query {
        author {
          firstName
          lastName
        }
      }
    `;
    const networkError = new Error('Network error');
    mockQueryManager(reject, {
      request: { query },
      error: networkError,
    })
      .query({ query })
      .then(() => {
        reject(new Error('Returned result on an errored fetchQuery'));
      })
      .catch(error => {
        const apolloError = error as ApolloError;

        expect(apolloError.message).toBeDefined();
        expect(apolloError.networkError).toBe(networkError);
        expect(apolloError.graphQLErrors).toEqual([]);
        resolve();
      })
      .then(resolve, reject);
  });

  itAsync('should reject a query promise given a GraphQL error', (resolve, reject) => {
    const query = gql`
      query {
        author {
          firstName
          lastName
        }
      }
    `;
    const graphQLErrors = [new GraphQLError('GraphQL error')];
    return mockQueryManager(reject, {
      request: { query },
      result: { errors: graphQLErrors },
    })
      .query({ query })
      .then(
        () => {
          throw new Error('Returned result on an errored fetchQuery');
        },
        // don't use .catch() for this or it will catch the above error
        error => {
          const apolloError = error as ApolloError;
          expect(apolloError.graphQLErrors).toEqual(graphQLErrors);
          expect(!apolloError.networkError).toBeTruthy();
        },
      ).then(resolve, reject);
  });

  itAsync('should not empty the store when a non-polling query fails due to a network error', (resolve, reject) => {
    const query = gql`
      query {
        author {
          firstName
          lastName
        }
      }
    `;
    const data = {
      author: {
        firstName: 'Dhaivat',
        lastName: 'Pandya',
      },
    };
    const queryManager = mockQueryManager(
      reject,
      {
        request: { query },
        result: { data },
      },
      {
        request: { query },
        error: new Error('Network error ocurred'),
      },
    );
    queryManager
      .query<any>({ query })
      .then(result => {
        expect(stripSymbols(result.data)).toEqual(data);

        queryManager
          .query<any>({ query, fetchPolicy: 'network-only' })
          .then(() => {
            reject(
              new Error('Returned a result when it was not supposed to.'),
            );
          })
          .catch(() => {
            // make that the error thrown doesn't empty the state
            expect(
              queryManager.cache.extract().ROOT_QUERY!.author,
            ).toEqual(data.author);
            resolve();
          });
      })
      .catch(() => {
        reject(new Error('Threw an error on the first query.'));
      });
  });

  itAsync('should be able to unsubscribe from a polling query subscription', (resolve, reject) => {
    const query = gql`
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

    const observable = mockQueryManager(reject, {
      request: { query },
      result: { data },
    }).watchQuery({ query, pollInterval: 20 });

    const { promise, subscription } = observableToPromiseAndSubscription(
      {
        observable,
        wait: 60,
      },
      (result: any) => {
        expect(stripSymbols(result.data)).toEqual(data);
        subscription.unsubscribe();
      },
    );

    return promise.then(resolve, reject);
  });

  itAsync('should not empty the store when a polling query fails due to a network error', (resolve, reject) => {
    const query = gql`
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
    const queryManager = mockQueryManager(
      reject,
      {
        request: { query },
        result: { data },
      },
      {
        request: { query },
        error: new Error('Network error occurred.'),
      },
    );
    const observable = queryManager.watchQuery<any>({
      query,
      pollInterval: 20,
      notifyOnNetworkStatusChange: false,
    });

    return observableToPromise(
      {
        observable,
        errorCallbacks: [
          () => {
            expect(
              queryManager.cache.extract().ROOT_QUERY!.author,
            ).toEqual(data.author);
          },
        ],
      },
      result => {
        expect(stripSymbols(result.data)).toEqual(data);
        expect(
          queryManager.cache.extract().ROOT_QUERY!.author
        ).toEqual(data.author);
      },
    ).then(resolve, reject);
  });

  itAsync('should not fire next on an observer if there is no change in the result', (resolve, reject) => {
    const query = gql`
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
    const queryManager = mockQueryManager(
      reject,
      {
        request: { query },
        result: { data },
      },
      {
        request: { query },
        result: { data },
      },
    );

    const observable = queryManager.watchQuery<any>({ query });
    return Promise.all<any[] | void>([
      // we wait for a little bit to ensure the result of the second query
      // don't trigger another subscription event
      observableToPromise({ observable, wait: 100 }, result => {
        expect(stripSymbols(result.data)).toEqual(data);
      }),
      queryManager.query<any>({ query }).then(result => {
        expect(stripSymbols(result.data)).toEqual(data);
      }),
    ]).then(resolve, reject);
  });

  itAsync('should not return stale data when we orphan a real-id node in the store with a real-id node', (resolve, reject) => {
    const query1 = gql`
      query {
        author {
          name {
            firstName
            lastName
          }
          age
          id
          __typename
        }
      }
    `;
    const query2 = gql`
      query {
        author {
          name {
            firstName
          }
          id
          __typename
        }
      }
    `;
    const data1 = {
      author: {
        name: {
          firstName: 'John',
          lastName: 'Smith',
        },
        age: 18,
        id: '187',
        __typename: 'Author',
      },
    };
    const data2 = {
      author: {
        name: {
          firstName: 'John',
        },
        id: '197',
        __typename: 'Author',
      },
    };
    const reducerConfig = { dataIdFromObject };
    const queryManager = createQueryManager({
      link: mockSingleLink({
        request: { query: query1 },
        result: { data: data1 },
      }, {
        request: { query: query2 },
        result: { data: data2 },
      }, {
        request: { query: query1 },
        result: { data: data1 },
      }).setOnError(reject),
      config: reducerConfig,
    });

    const observable1 = queryManager.watchQuery<any>({ query: query1 });
    const observable2 = queryManager.watchQuery<any>({ query: query2 });

    // I'm not sure the waiting 60 here really is required, but the test used to do it
    return Promise.all([
      observableToPromise(
        {
          observable: observable1,
          wait: 60,
        },
        result => {
          expect(stripSymbols(result)).toEqual({
            data: data1,
            loading: false,
            networkStatus: NetworkStatus.ready,
          });
        },
      ),
      observableToPromise(
        {
          observable: observable2,
          wait: 60,
        },
        result => {
          expect(stripSymbols(result)).toEqual({
            data: data2,
            loading: false,
            networkStatus: NetworkStatus.ready,
          });
        },
      ),
    ]).then(resolve, reject);
  });

  itAsync('should return partial data when configured when we orphan a real-id node in the store with a real-id node', (resolve, reject) => {
    const query1 = gql`
      query {
        author {
          name {
            firstName
            lastName
          }
          age
          id
          __typename
        }
      }
    `;
    const query2 = gql`
      query {
        author {
          name {
            firstName
          }
          id
          __typename
        }
      }
    `;
    const data1 = {
      author: {
        name: {
          firstName: 'John',
          lastName: 'Smith',
        },
        age: 18,
        id: '187',
        __typename: 'Author',
      },
    };
    const data2 = {
      author: {
        name: {
          firstName: 'John',
        },
        id: '197',
        __typename: 'Author',
      },
    };

    const queryManager = createQueryManager({
      link: mockSingleLink({
        request: { query: query1 },
        result: { data: data1 },
      }, {
        request: { query: query2 },
        result: { data: data2 },
      }).setOnError(reject),
    });

    const observable1 = queryManager.watchQuery<any>({
      query: query1,
      returnPartialData: true,
    });
    const observable2 = queryManager.watchQuery<any>({ query: query2 });

    return Promise.all([
      observableToPromise(
        {
          observable: observable1,
        },
        result => {
          expect(result).toEqual({
            data: {},
            loading: true,
            networkStatus: NetworkStatus.loading,
            partial: true,
          });
        },
        result => {
          expect(result).toEqual({
            data: data1,
            loading: false,
            networkStatus: NetworkStatus.ready,
          });
        },
      ),
      observableToPromise(
        {
          observable: observable2,
        },
        result => {
          expect(result).toEqual({
            data: data2,
            loading: false,
            networkStatus: NetworkStatus.ready,
          });
        },
      ),
    ]).then(resolve, reject);
  });

  itAsync("should not write unchanged network results to cache", (resolve, reject) => {
    const cache = new InMemoryCache({
      typePolicies: {
        Query: {
          fields: {
            info: {
              merge: false,
            },
          },
        },
      },
    });

    const client = new ApolloClient({
      cache,
      link: new ApolloLink(operation => new Observable((observer: Observer<FetchResult>) => {
        switch (operation.operationName) {
          case "A":
            observer.next!({ data: { info: { a: "ay" }}});
            break;
          case "B":
            observer.next!({ data: { info: { b: "bee" }}});
            break;
        }
        observer.complete!();
      })),
    });

    const queryA = gql`query A { info { a } }`;
    const queryB = gql`query B { info { b } }`;

    const obsA = client.watchQuery({
      query: queryA,
      returnPartialData: true,
    });

    const obsB = client.watchQuery({
      query: queryB,
      returnPartialData: true,
    });

    subscribeAndCount(reject, obsA, (count, result) => {
      if (count === 1) {
        expect(result).toEqual({
          loading: true,
          networkStatus: NetworkStatus.loading,
          data: {},
          partial: true,
        });
      } else if (count === 2) {
        expect(result).toEqual({
          loading: false,
          networkStatus: NetworkStatus.ready,
          data: {
            info: {
              a: "ay",
            },
          },
        });
      } else if (count === 3) {
        expect(result).toEqual({
          loading: true,
          networkStatus: NetworkStatus.loading,
          data: {
            info: {},
          },
          partial: true,
        });
      } else if (count === 4) {
        expect(result).toEqual({
          loading: false,
          networkStatus: NetworkStatus.ready,
          data: {
            info: {
              a: "ay",
            },
          },
        });
        setTimeout(resolve, 100);
      } else {
        reject(new Error(`Unexpected ${JSON.stringify({count,result})}`));
      }
    });

    subscribeAndCount(reject, obsB, (count, result) => {
      if (count === 1) {
        expect(result).toEqual({
          loading: true,
          networkStatus: NetworkStatus.loading,
          data: {},
          partial: true,
        });
      } else if (count === 2) {
        expect(result).toEqual({
          loading: false,
          networkStatus: NetworkStatus.ready,
          data: {
            info: {
              b: "bee",
            },
          },
        });
      } else if (count === 3) {
        expect(result).toEqual({
          loading: true,
          networkStatus: NetworkStatus.loading,
          data: {
            info: {},
          },
        });
      } else if (count === 4) {
        expect(result).toEqual({
          loading: false,
          networkStatus: NetworkStatus.ready,
          data: {
            info: {
              b: "bee",
            },
          },
        });
        setTimeout(resolve, 100);
      } else {
        reject(new Error(`Unexpected ${JSON.stringify({count,result})}`));
      }
    });
  });

  itAsync("should disable feud-stopping logic after evict or modify", (resolve, reject) => {
    const cache = new InMemoryCache({
      typePolicies: {
        Query: {
          fields: {
            info: {
              merge: false,
            },
          },
        },
      },
    });

    const client = new ApolloClient({
      cache,
      link: new ApolloLink(operation => new Observable((observer: Observer<FetchResult>) => {
        observer.next!({ data: { info: { c: "see" }}});
        observer.complete!();
      })),
    });

    const query = gql`query { info { c } }`;

    const obs = client.watchQuery({
      query,
      returnPartialData: true,
    });

    subscribeAndCount(reject, obs, (count, result) => {
      if (count === 1) {
        expect(result).toEqual({
          loading: true,
          networkStatus: NetworkStatus.loading,
          data: {},
          partial: true,
        });

      } else if (count === 2) {
        expect(result).toEqual({
          loading: false,
          networkStatus: NetworkStatus.ready,
          data: {
            info: {
              c: "see",
            },
          },
        });

        cache.evict({
          fieldName: "info",
        });

      } else if (count === 3) {
        expect(result).toEqual({
          loading: true,
          networkStatus: NetworkStatus.loading,
          data: {},
          partial: true,
        });

      } else if (count === 4) {
        expect(result).toEqual({
          loading: false,
          networkStatus: NetworkStatus.ready,
          data: {
            info: {
              c: "see",
            },
          },
        });

        cache.modify({
          fields: {
            info(_, { DELETE }) {
              return DELETE;
            },
          },
        });

      } else if (count === 5) {
        expect(result).toEqual({
          loading: true,
          networkStatus: NetworkStatus.loading,
          data: {},
          partial: true,
        });

      } else if (count === 6) {
        expect(result).toEqual({
          loading: false,
          networkStatus: NetworkStatus.ready,
          data: {
            info: {
              c: "see",
            },
          },
        });

        setTimeout(resolve, 100);

      } else {
        reject(new Error(`Unexpected ${JSON.stringify({count,result})}`));
      }
    });
  });

  itAsync('should not error when replacing unidentified data with a normalized ID', (resolve, reject) => {
    const queryWithoutId = gql`
      query {
        author {
          name {
            firstName
            lastName
          }
          age
          __typename
        }
      }
    `;

    const queryWithId = gql`
      query {
        author {
          name {
            firstName
          }
          id
          __typename
        }
      }
    `;

    const dataWithoutId = {
      author: {
        name: {
          firstName: 'John',
          lastName: 'Smith',
        },
        age: '124',
        __typename: 'Author',
      },
    };

    const dataWithId = {
      author: {
        name: {
          firstName: 'Jane',
        },
        id: '129',
        __typename: 'Author',
      },
    };

    let mergeCount = 0;
    const queryManager = createQueryManager({
      link: mockSingleLink({
        request: { query: queryWithoutId },
        result: { data: dataWithoutId },
      }, {
        request: { query: queryWithId },
        result: { data: dataWithId },
      }).setOnError(reject),
      config: {
        typePolicies: {
          Query: {
            fields: {
              author: {
                merge(existing, incoming, { isReference, readField }) {
                  switch (++mergeCount) {
                    case 1:
                      expect(existing).toBeUndefined();
                      expect(isReference(incoming)).toBe(false);
                      expect(incoming).toEqual(dataWithoutId.author);
                      break;
                    case 2:
                      expect(existing).toEqual(dataWithoutId.author);
                      expect(isReference(incoming)).toBe(true);
                      expect(readField("id", incoming)).toBe("129");
                      expect(readField("name", incoming)).toEqual(dataWithId.author.name);
                      break;
                    default:
                      fail("unreached");
                  }
                  return incoming;
                },
              },
            },
          },
        },
      },
    });

    const observableWithId = queryManager.watchQuery<any>({
      query: queryWithId,
    });

    const observableWithoutId = queryManager.watchQuery<any>({
      query: queryWithoutId,
    });

    return Promise.all([
      observableToPromise(
        { observable: observableWithoutId },
        result => expect(stripSymbols(result.data)).toEqual(dataWithoutId),
      ),
      observableToPromise(
        { observable: observableWithId },
        result => expect(stripSymbols(result.data)).toEqual(dataWithId),
      ),
    ]).then(resolve, reject);
  });

  itAsync('exposes errors on a refetch as a rejection', async (resolve, reject) => {
    const request = {
      query: gql`
        {
          people_one(id: 1) {
            name
          }
        }
      `,
    };
    const firstResult = {
      data: {
        people_one: {
          name: 'Luke Skywalker',
        },
      },
    };
    const secondResult = {
      errors: [
        new GraphQLError('This is not the person you are looking for.'),
      ],
    };

    const queryManager = mockRefetch({
      reject,
      request,
      firstResult,
      secondResult,
    });

    const handle = queryManager.watchQuery<any>(request);

    const checkError = (error: ApolloError) => {
      expect(error.graphQLErrors[0].message).toEqual('This is not the person you are looking for.')
    };

    handle.subscribe({
      error: checkError,
    });

    handle
      .refetch()
      .then(() => {
        reject(new Error('Error on refetch should reject promise'));
      })
      .catch(error => {
        checkError(error);
      })
      .then(resolve, reject);
  });

  itAsync('does not return incomplete data when two queries for the same item are executed', (resolve, reject) => {
    const queryA = gql`
      query queryA {
        person(id: "abc") {
          __typename
          id
          firstName
          lastName
        }
      }
    `;
    const queryB = gql`
      query queryB {
        person(id: "abc") {
          __typename
          id
          lastName
          age
        }
      }
    `;
    const dataA = {
      person: {
        __typename: 'Person',
        id: 'abc',
        firstName: 'Luke',
        lastName: 'Skywalker',
      },
    };
    const dataB = {
      person: {
        __typename: 'Person',
        id: 'abc',
        lastName: 'Skywalker',
        age: '32',
      },
    };
    const queryManager = new QueryManager<NormalizedCacheObject>({
      link: mockSingleLink(
        { request: { query: queryA }, result: { data: dataA } },
        { request: { query: queryB }, result: { data: dataB }, delay: 20 }
      ).setOnError(reject),
      cache: new InMemoryCache({}),
      ssrMode: true,
    });

    const observableA = queryManager.watchQuery({
      query: queryA,
    });
    const observableB = queryManager.watchQuery({
      query: queryB,
    });

    return Promise.all([
      observableToPromise({ observable: observableA }, () => {
        expect(
          stripSymbols(getCurrentQueryResult(observableA)),
        ).toEqual({
          data: dataA,
          partial: false,
        });
        expect(getCurrentQueryResult(observableB)).toEqual({
          data: undefined,
          partial: true,
        });
      }),
      observableToPromise({ observable: observableB }, () => {
        expect(
          stripSymbols(getCurrentQueryResult(observableA)),
        ).toEqual({
          data: dataA,
          partial: false,
        });
        expect(getCurrentQueryResult(observableB)).toEqual({
          data: dataB,
          partial: false,
        });
      }),
    ]).then(resolve, reject);
  });


  itAsync('only increments "queryInfo.lastRequestId" when fetching data from network', (resolve, reject) => {
    const query = gql`
      query query($id: ID!) {
        people_one(id: $id) {
          name
        }
      }
    `;
    const variables = { id: 1 };
    const dataOne = {
      people_one: {
        name: 'Luke Skywalker',
      },
    };
    const mockedResponses = [
      {
        request: { query, variables },
        result: { data: dataOne },
      },
    ];

    const queryManager = mockQueryManager(reject, ...mockedResponses);
    const queryOptions: WatchQueryOptions<any> = {
      query,
      variables,
      fetchPolicy: 'cache-and-network',
    };
    const observable = queryManager.watchQuery(queryOptions);

    const mocks = mockFetchQuery(queryManager);
    const queryId = '1';
    const getQuery: QueryManager<any>["getQuery"] =
      (queryManager as any).getQuery.bind(queryManager);

    subscribeAndCount(reject, observable, async (handleCount) => {
      const query = getQuery(queryId);
      const fqbpCalls = mocks.fetchQueryByPolicy.mock.calls;
      expect(query.lastRequestId).toEqual(1);
      expect(fqbpCalls.length).toBe(1);

      // Simulate updating the options of the query, which will trigger
      // fetchQueryByPolicy, but it should just read from cache and not
      // update "queryInfo.lastRequestId". For more information, see
      // https://github.com/apollographql/apollo-client/pull/7956#issue-610298427
      await observable.setOptions({
        ...queryOptions,
        fetchPolicy: 'cache-first',
      });

      // "fetchQueryByPolicy" was called, but "lastRequestId" does not update
      // since it was able to read from cache.
      expect(query.lastRequestId).toEqual(1);
      expect(fqbpCalls.length).toBe(2);
      resolve();
    });
  })

  describe('polling queries', () => {
    itAsync('allows you to poll queries', (resolve, reject) => {
      const query = gql`
        query fetchLuke($id: String) {
          people_one(id: $id) {
            name
          }
        }
      `;

      const variables = {
        id: '1',
      };

      const data1 = {
        people_one: {
          name: 'Luke Skywalker',
        },
      };

      const data2 = {
        people_one: {
          name: 'Luke Skywalker has a new name',
        },
      };

      const queryManager = mockQueryManager(
        reject,
        {
          request: { query, variables },
          result: { data: data1 },
        },
        {
          request: { query, variables },
          result: { data: data2 },
        },
      );
      const observable = queryManager.watchQuery<any>({
        query,
        variables,
        pollInterval: 50,
        notifyOnNetworkStatusChange: false,
      });

      return observableToPromise(
        { observable },
        result => expect(stripSymbols(result.data)).toEqual(data1),
        result => expect(stripSymbols(result.data)).toEqual(data2),
      ).then(resolve, reject);
    });

    itAsync('does not poll during SSR', (resolve, reject) => {
      const query = gql`
        query fetchLuke($id: String) {
          people_one(id: $id) {
            name
          }
        }
      `;

      const variables = {
        id: '1',
      };

      const data1 = {
        people_one: {
          name: 'Luke Skywalker',
        },
      };

      const data2 = {
        people_one: {
          name: 'Luke Skywalker has a new name',
        },
      };

      const queryManager = new QueryManager<NormalizedCacheObject>({
        link: mockSingleLink({
          request: { query, variables },
          result: { data: data1 },
        }, {
          request: { query, variables },
          result: { data: data2 },
        }, {
          request: { query, variables },
          result: { data: data2 },
        }).setOnError(reject),
        cache: new InMemoryCache({ addTypename: false }),
        ssrMode: true,
      });

      const observable = queryManager.watchQuery<any>({
        query,
        variables,
        pollInterval: 10,
        notifyOnNetworkStatusChange: false,
      });

      let count = 1;
      const subHandle = observable.subscribe({
        next: (result: any) => {
          switch (count) {
            case 1:
              expect(stripSymbols(result.data)).toEqual(data1);
              setTimeout(() => {
                subHandle.unsubscribe();
                resolve();
              }, 15);
              count++;
              break;
            case 2:
            default:
              reject(new Error('Only expected one result, not multiple'));
          }
        },
      });
    });

    itAsync('should let you handle multiple polled queries and unsubscribe from one of them', (resolve, reject) => {
      const query1 = gql`
        query {
          author {
            firstName
            lastName
          }
        }
      `;
      const query2 = gql`
        query {
          person {
            name
          }
        }
      `;
      const data11 = {
        author: {
          firstName: 'John',
          lastName: 'Smith',
        },
      };
      const data12 = {
        author: {
          firstName: 'Jack',
          lastName: 'Smith',
        },
      };
      const data13 = {
        author: {
          firstName: 'Jolly',
          lastName: 'Smith',
        },
      };
      const data14 = {
        author: {
          firstName: 'Jared',
          lastName: 'Smith',
        },
      };
      const data21 = {
        person: {
          name: 'Jane Smith',
        },
      };
      const data22 = {
        person: {
          name: 'Josey Smith',
        },
      };
      const queryManager = mockQueryManager(
        reject,
        {
          request: { query: query1 },
          result: { data: data11 },
        },
        {
          request: { query: query1 },
          result: { data: data12 },
        },
        {
          request: { query: query1 },
          result: { data: data13 },
        },
        {
          request: { query: query1 },
          result: { data: data14 },
        },
        {
          request: { query: query2 },
          result: { data: data21 },
        },
        {
          request: { query: query2 },
          result: { data: data22 },
        },
      );
      let handle1Count = 0;
      let handleCount = 0;
      let setMilestone = false;

      const subscription1 = queryManager
        .watchQuery({
          query: query1,
          pollInterval: 150,
        })
        .subscribe({
          next() {
            handle1Count++;
            handleCount++;
            if (handle1Count > 1 && !setMilestone) {
              subscription1.unsubscribe();
              setMilestone = true;
            }
          },
        });

      const subscription2 = queryManager
        .watchQuery({
          query: query2,
          pollInterval: 2000,
        })
        .subscribe({
          next() {
            handleCount++;
          },
        });

      setTimeout(() => {
        expect(handleCount).toBe(3);
        subscription1.unsubscribe();
        subscription2.unsubscribe();

        resolve();
      }, 400);
    });

    itAsync('allows you to unsubscribe from polled queries', (resolve, reject) => {
      const query = gql`
        query fetchLuke($id: String) {
          people_one(id: $id) {
            name
          }
        }
      `;

      const variables = {
        id: '1',
      };

      const data1 = {
        people_one: {
          name: 'Luke Skywalker',
        },
      };

      const data2 = {
        people_one: {
          name: 'Luke Skywalker has a new name',
        },
      };

      const queryManager = mockQueryManager(
        reject,
        {
          request: { query, variables },
          result: { data: data1 },
        },
        {
          request: { query, variables },
          result: { data: data2 },
        },
      );
      const observable = queryManager.watchQuery({
        query,
        variables,
        pollInterval: 50,
        notifyOnNetworkStatusChange: false,
      });

      const { promise, subscription } = observableToPromiseAndSubscription(
        {
          observable,
          wait: 60,
        },
        result => expect(stripSymbols(result.data)).toEqual(data1),
        result => {
          expect(stripSymbols(result.data)).toEqual(data2);

          // we unsubscribe here manually, rather than waiting for the timeout.
          subscription.unsubscribe();
        },
      );

      return promise.then(resolve, reject);
    });

    itAsync('allows you to unsubscribe from polled query errors', (resolve, reject) => {
      const query = gql`
        query fetchLuke($id: String) {
          people_one(id: $id) {
            name
          }
        }
      `;

      const variables = {
        id: '1',
      };

      const data1 = {
        people_one: {
          name: 'Luke Skywalker',
        },
      };

      const data2 = {
        people_one: {
          name: 'Luke Skywalker has a new name',
        },
      };

      const queryManager = mockQueryManager(
        reject,
        {
          request: { query, variables },
          result: { data: data1 },
        },
        {
          request: { query, variables },
          error: new Error('Network error'),
        },
        {
          request: { query, variables },
          result: { data: data2 },
        },
      );

      const observable = queryManager.watchQuery<any>({
        query,
        variables,
        pollInterval: 50,
        notifyOnNetworkStatusChange: false,
      });

      let isFinished = false;
      process.once('unhandledRejection', () => {
        if (!isFinished) reject('unhandledRejection from network');
      });

      const { promise, subscription } = observableToPromiseAndSubscription(
        {
          observable,
          wait: 60,
          errorCallbacks: [
            error => {
              expect(error.message).toMatch('Network error');
              subscription.unsubscribe();
            },
          ],
        },
        result => expect(stripSymbols(result.data)).toEqual(data1),
      );

      promise.then(() => {
        setTimeout(() => {
          isFinished = true;
          resolve();
        }, 4);
      });
    });

    itAsync('exposes a way to start a polling query', (resolve, reject) => {
      const query = gql`
        query fetchLuke($id: String) {
          people_one(id: $id) {
            name
          }
        }
      `;

      const variables = {
        id: '1',
      };

      const data1 = {
        people_one: {
          name: 'Luke Skywalker',
        },
      };

      const data2 = {
        people_one: {
          name: 'Luke Skywalker has a new name',
        },
      };

      const queryManager = mockQueryManager(
        reject,
        {
          request: { query, variables },
          result: { data: data1 },
        },
        {
          request: { query, variables },
          result: { data: data2 },
        },
      );

      const observable = queryManager.watchQuery<any>({
        query,
        variables,
        notifyOnNetworkStatusChange: false,
      });
      observable.startPolling(50);

      return observableToPromise(
        { observable },
        result => expect(stripSymbols(result.data)).toEqual(data1),
        result => expect(stripSymbols(result.data)).toEqual(data2),
      ).then(resolve, reject);
    });

    itAsync('exposes a way to stop a polling query', (resolve, reject) => {
      const query = gql`
        query fetchLeia($id: String) {
          people_one(id: $id) {
            name
          }
        }
      `;

      const variables = {
        id: '2',
      };

      const data1 = {
        people_one: {
          name: 'Leia Skywalker',
        },
      };

      const data2 = {
        people_one: {
          name: 'Leia Skywalker has a new name',
        },
      };

      const queryManager = mockQueryManager(
        reject,
        {
          request: { query, variables },
          result: { data: data1 },
        },
        {
          request: { query, variables },
          result: { data: data2 },
        },
      );
      const observable = queryManager.watchQuery<any>({
        query,
        variables,
        pollInterval: 50,
      });

      return observableToPromise({ observable, wait: 60 }, result => {
        expect(stripSymbols(result.data)).toEqual(data1);
        observable.stopPolling();
      }).then(resolve, reject);
    });

    itAsync('stopped polling queries still get updates', (resolve, reject) => {
      const query = gql`
        query fetchLeia($id: String) {
          people_one(id: $id) {
            name
          }
        }
      `;

      const variables = {
        id: '2',
      };

      const data1 = {
        people_one: {
          name: 'Leia Skywalker',
        },
      };

      const data2 = {
        people_one: {
          name: 'Leia Skywalker has a new name',
        },
      };

      const queryManager = mockQueryManager(
        reject,
        {
          request: { query, variables },
          result: { data: data1 },
        },
        {
          request: { query, variables },
          result: { data: data2 },
        },
      );

      const observable = queryManager.watchQuery({
        query,
        variables,
        pollInterval: 50,
      });

      return Promise.all([
        observableToPromise(
          { observable },
          result => {
            expect(stripSymbols(result.data)).toEqual(data1);
            queryManager.query({
              query,
              variables,
              fetchPolicy: 'network-only',
            }).then(result => {
              expect(result.data).toEqual(data2);
            }).catch(reject);
          },
          result => {
            expect(stripSymbols(result.data)).toEqual(data2);
          },
        ),
      ]).then(resolve, reject);
    });
  });
  describe('store resets', () => {
    itAsync('returns a promise resolving when all queries have been refetched', (resolve, reject) => {
      const query = gql`
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

      const dataChanged = {
        author: {
          firstName: 'John changed',
          lastName: 'Smith',
        },
      };

      const query2 = gql`
        query {
          author2 {
            firstName
            lastName
          }
        }
      `;

      const data2 = {
        author2: {
          firstName: 'John',
          lastName: 'Smith',
        },
      };

      const data2Changed = {
        author2: {
          firstName: 'John changed',
          lastName: 'Smith',
        },
      };

      const queryManager = createQueryManager({
        link: mockSingleLink({
          request: { query },
          result: { data },
        }, {
          request: { query: query2 },
          result: { data: data2 },
        }, {
          request: { query },
          result: { data: dataChanged },
        }, {
          request: { query: query2 },
          result: { data: data2Changed },
        }).setOnError(reject),
      });

      const observable = queryManager.watchQuery<any>({ query });
      const observable2 = queryManager.watchQuery<any>({ query: query2 });

      return Promise.all([
        observableToPromise({ observable }, result =>
          expect(stripSymbols(result.data)).toEqual(data),
        ),
        observableToPromise({ observable: observable2 }, result =>
          expect(stripSymbols(result.data)).toEqual(data2),
        ),
      ]).then(() => {
        observable.subscribe({ next: () => null });
        observable2.subscribe({ next: () => null });

        return queryManager.resetStore().then(() => {
          const result = getCurrentQueryResult(observable);
          expect(result.partial).toBe(false);
          expect(stripSymbols(result.data)).toEqual(dataChanged);

          const result2 = getCurrentQueryResult(observable2);
          expect(result2.partial).toBe(false);
          expect(stripSymbols(result2.data)).toEqual(data2Changed);
        });
      }).then(resolve, reject);
    });

    itAsync('should change the store state to an empty state', (resolve, reject) => {
      const queryManager = createQueryManager({
        link: mockSingleLink().setOnError(reject),
      });

      queryManager.resetStore();

      expect(
        queryManager.cache.extract(),
      ).toEqual({});
      expect(queryManager.getQueryStore()).toEqual({});
      expect(queryManager.mutationStore).toEqual({});

      resolve();
    });

    xit('should only refetch once when we store reset', () => {
      let queryManager: QueryManager<NormalizedCacheObject>;
      const query = gql`
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

      const data2 = {
        author: {
          firstName: 'Johnny',
          lastName: 'Smith',
        },
      };

      let timesFired = 0;
      const link: ApolloLink = new ApolloLink(
        op =>
          new Observable(observer => {
            timesFired += 1;
            if (timesFired > 1) {
              observer.next({ data: data2 });
            } else {
              observer.next({ data });
            }
            observer.complete();
            return;
          }),
      );
      queryManager = createQueryManager({ link });
      const observable = queryManager.watchQuery<any>({ query });

      // wait just to make sure the observable doesn't fire again
      return observableToPromise(
        { observable, wait: 0 },
        result => {
          expect(stripSymbols(result.data)).toEqual(data);
          expect(timesFired).toBe(1);
          // reset the store after data has returned
          queryManager.resetStore();
        },
        result => {
          // only refetch once and make sure data has changed
          expect(stripSymbols(result.data)).toEqual(data2);
          expect(timesFired).toBe(2);
        },
      );
    });

    itAsync('should not refetch torn-down queries', (resolve, reject) => {
      let queryManager: QueryManager<NormalizedCacheObject>;
      let observable: ObservableQuery<any>;
      const query = gql`
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
        () =>
          new Observable(observer => {
            timesFired += 1;
            observer.next({ data });
            return;
          }),
      ]);

      queryManager = createQueryManager({ link });
      observable = queryManager.watchQuery({ query });

      observableToPromise({ observable, wait: 0 }, result =>
        expect(stripSymbols(result.data)).toEqual(data),
      ).then(() => {
        expect(timesFired).toBe(1);

        // at this point the observable query has been torn down
        // because observableToPromise unsubscribe before resolving
        queryManager.resetStore();

        setTimeout(() => {
          expect(timesFired).toBe(1);

          resolve();
        }, 50);
      });
    });

    itAsync('should not error when resetStore called', (resolve, reject) => {
      const query = gql`
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
      const link = ApolloLink.from([
        new ApolloLink(
          () =>
            new Observable(observer => {
              timesFired += 1;
              observer.next({ data });
              observer.complete();
              return;
            }),
        ),
      ]);

      const queryManager = createQueryManager({ link });

      const observable = queryManager.watchQuery<any>({
        query,
        notifyOnNetworkStatusChange: false,
      });

      // wait to make sure store reset happened
      return observableToPromise(
        { observable, wait: 20 },
        result => {
          expect(stripSymbols(result.data)).toEqual(data);
          expect(timesFired).toBe(1);
          queryManager.resetStore().catch(reject);
        },
        result => {
          expect(stripSymbols(result.data)).toEqual(data);
          expect(timesFired).toBe(2);
        },
      ).then(resolve, reject);
    });

    itAsync('should not error on a stopped query()', (resolve, reject) => {
      let queryManager: QueryManager<NormalizedCacheObject>;
      const query = gql`
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

      const link = new ApolloLink(
        () =>
          new Observable(observer => {
            observer.next({ data });
          }),
      );

      queryManager = createQueryManager({ link });

      const queryId = '1';
      queryManager
        .fetchQuery(queryId, { query })
        .catch(e => reject('Exception thrown for stopped query'));

      queryManager.removeQuery(queryId);
      queryManager.resetStore().then(resolve, reject);
    });

    itAsync('should throw an error on an inflight fetch query if the store is reset', (resolve, reject) => {
      const query = gql`
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
      const queryManager = mockQueryManager(reject, {
        request: { query },
        result: { data },
        delay: 10000, //i.e. forever
      });
      queryManager
        .fetchQuery('made up id', { query })
        .then(() => {
          reject(new Error('Returned a result.'));
        })
        .catch(error => {
          expect(error.message).toMatch('Store reset');
          resolve();
        });
      // Need to delay the reset at least until the fetchRequest method
      // has had a chance to enter this request into fetchQueryRejectFns.
      setTimeout(() => queryManager.resetStore(), 100);
    });

    itAsync('should call refetch on a mocked Observable if the store is reset', (resolve, reject) => {
      const query = gql`
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
      const queryManager = mockQueryManager(reject, {
        request: { query },
        result: { data }
      });
      const obs = queryManager.watchQuery<any>({ query });
      obs.subscribe({});
      obs.refetch = resolve as any;

      queryManager.resetStore();
    });

    itAsync('should not call refetch on a cache-only Observable if the store is reset', (resolve, reject) => {
      const query = gql`
        query {
          author {
            firstName
            lastName
          }
        }
      `;

      const queryManager = createQueryManager({
        link: mockSingleLink().setOnError(reject),
      });

      const options = {
        query,
        fetchPolicy: "cache-only",
      } as WatchQueryOptions;

      let refetchCount = 0;

      const obs = queryManager.watchQuery(options);
      obs.subscribe({});
      obs.refetch = () => {
        ++refetchCount;
        return null as never;
      };

      queryManager.resetStore();

      setTimeout(() => {
        expect(refetchCount).toEqual(0);
        resolve();
      }, 50);
    });

    itAsync('should not call refetch on a standby Observable if the store is reset', (resolve, reject) => {
      const query = gql`
        query {
          author {
            firstName
            lastName
          }
        }
      `;

      const queryManager = createQueryManager({
        link: mockSingleLink().setOnError(reject),
      });

      const options = {
        query,
        fetchPolicy: "standby",
      } as WatchQueryOptions;

      let refetchCount = 0;

      const obs = queryManager.watchQuery(options);
      obs.subscribe({});
      obs.refetch = () => {
        ++refetchCount;
        return null as never;
      };

      queryManager.resetStore();

      setTimeout(() => {
        expect(refetchCount).toEqual(0);
        resolve();
      }, 50);
    });

    itAsync('should not call refetch on a non-subscribed Observable if the store is reset', (resolve, reject) => {
      const query = gql`
        query {
          author {
            firstName
            lastName
          }
        }
      `;

      const queryManager = createQueryManager({
        link: mockSingleLink().setOnError(reject),
      });

      const options = {
        query,
      } as WatchQueryOptions;

      let refetchCount = 0;

      const obs = queryManager.watchQuery(options);
      obs.refetch = () => {
        ++refetchCount;
        return null as never;
      };

      queryManager.resetStore();

      setTimeout(() => {
        expect(refetchCount).toEqual(0);
        resolve();
      }, 50);
    });

    itAsync('should throw an error on an inflight query() if the store is reset', (resolve, reject) => {
      let queryManager: QueryManager<NormalizedCacheObject>;
      const query = gql`
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
      const link = new ApolloLink(
        () =>
          new Observable(observer => {
            // reset the store as soon as we hear about the query
            queryManager.resetStore();
            observer.next({ data });
            return;
          }),
      );

      queryManager = createQueryManager({ link });
      queryManager
        .query<any>({ query })
        .then(() => {
          reject(new Error('query() gave results on a store reset'));
        })
        .catch(() => {
          resolve();
        });
    });
  });
  describe('refetching observed queries', () => {
    itAsync('returns a promise resolving when all queries have been refetched', (resolve, reject) => {
      const query = gql`
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

      const dataChanged = {
        author: {
          firstName: 'John changed',
          lastName: 'Smith',
        },
      };

      const query2 = gql`
        query {
          author2 {
            firstName
            lastName
          }
        }
      `;

      const data2 = {
        author2: {
          firstName: 'John',
          lastName: 'Smith',
        },
      };

      const data2Changed = {
        author2: {
          firstName: 'John changed',
          lastName: 'Smith',
        },
      };

      const queryManager = createQueryManager({
        link: mockSingleLink({
          request: { query },
          result: { data },
        }, {
          request: { query: query2 },
          result: { data: data2 },
        }, {
          request: { query },
          result: { data: dataChanged },
        }, {
          request: { query: query2 },
          result: { data: data2Changed },
        }).setOnError(reject),
      });

      const observable = queryManager.watchQuery<any>({ query });
      const observable2 = queryManager.watchQuery<any>({ query: query2 });

      return Promise.all([
        observableToPromise({ observable }, result =>
          expect(stripSymbols(result.data)).toEqual(data),
        ),
        observableToPromise({ observable: observable2 }, result =>
          expect(stripSymbols(result.data)).toEqual(data2),
        ),
      ]).then(() => {
        observable.subscribe({ next: () => null });
        observable2.subscribe({ next: () => null });

        return queryManager.reFetchObservableQueries().then(() => {
          const result = getCurrentQueryResult(observable);
          expect(result.partial).toBe(false);
          expect(stripSymbols(result.data)).toEqual(dataChanged);

          const result2 = getCurrentQueryResult(observable2);
          expect(result2.partial).toBe(false);
          expect(stripSymbols(result2.data)).toEqual(data2Changed);
        });
      }).then(resolve, reject);
    });

    itAsync('should only refetch once when we refetch observable queries', (resolve, reject) => {
      let queryManager: QueryManager<NormalizedCacheObject>;
      const query = gql`
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

      const data2 = {
        author: {
          firstName: 'Johnny',
          lastName: 'Smith',
        },
      };

      let timesFired = 0;
      const link: ApolloLink = new ApolloLink(
        op =>
          new Observable(observer => {
            timesFired += 1;
            if (timesFired > 1) {
              observer.next({ data: data2 });
            } else {
              observer.next({ data });
            }
            observer.complete();
            return;
          }),
      );
      queryManager = createQueryManager({ link });
      const observable = queryManager.watchQuery<any>({ query });

      // wait just to make sure the observable doesn't fire again
      return observableToPromise(
        { observable, wait: 0 },
        result => {
          expect(stripSymbols(result.data)).toEqual(data);
          expect(timesFired).toBe(1);
          // refetch the observed queries after data has returned
          queryManager.reFetchObservableQueries();
        },
        result => {
          // only refetch once and make sure data has changed
          expect(stripSymbols(result.data)).toEqual(data2);
          expect(timesFired).toBe(2);
          resolve();
        },
      ).catch(e => {
        reject(e);
      });
    });

    itAsync('should not refetch torn-down queries', (resolve, reject) => {
      let queryManager: QueryManager<NormalizedCacheObject>;
      let observable: ObservableQuery<any>;
      const query = gql`
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
        () =>
          new Observable(observer => {
            timesFired += 1;
            observer.next({ data });
            return;
          }),
      ]);

      queryManager = createQueryManager({ link });
      observable = queryManager.watchQuery({ query });

      observableToPromise({ observable, wait: 0 }, result =>
        expect(stripSymbols(result.data)).toEqual(data),
      ).then(() => {
        expect(timesFired).toBe(1);

        // at this point the observable query has been torn down
        // because observableToPromise unsubscribe before resolving
        queryManager.reFetchObservableQueries();

        setTimeout(() => {
          expect(timesFired).toBe(1);

          resolve();
        }, 50);
      });
    });

    itAsync('should not error after reFetchObservableQueries', (resolve, reject) => {
      const query = gql`
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
      const link = ApolloLink.from([
        () => new Observable(observer => {
          timesFired += 1;
          observer.next({ data });
          observer.complete();
        }),
      ]);

      const queryManager = createQueryManager({ link });

      const observable = queryManager.watchQuery<any>({
        query,
        notifyOnNetworkStatusChange: false,
      });

      // wait to make sure store reset happened
      return observableToPromise(
        { observable, wait: 20 },
        result => {
          expect(stripSymbols(result.data)).toEqual(data);
          expect(timesFired).toBe(1);
          queryManager.reFetchObservableQueries();
        },
        result => {
          expect(stripSymbols(result.data)).toEqual(data);
          expect(timesFired).toBe(2);
        },
      ).then(resolve, reject);
    });

    itAsync('should NOT throw an error on an inflight fetch query if the observable queries are refetched', (resolve, reject) => {
      const query = gql`
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
      const queryManager = mockQueryManager(reject, {
        request: { query },
        result: { data },
        delay: 100,
      });
      queryManager
        .fetchQuery('made up id', { query })
        .then(resolve)
        .catch(error => {
          reject(new Error('Should not return an error'));
        });
      queryManager.reFetchObservableQueries();
    });

    itAsync('should call refetch on a mocked Observable if the observed queries are refetched', (resolve, reject) => {
      const query = gql`
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
      const queryManager = mockQueryManager(reject, {
        request: { query },
        result: { data },
      });

      const obs = queryManager.watchQuery({ query });
      obs.subscribe({});
      obs.refetch = resolve as any;

      queryManager.reFetchObservableQueries();
    });

    itAsync('should not call refetch on a cache-only Observable if the observed queries are refetched', (resolve, reject) => {
      const query = gql`
        query {
          author {
            firstName
            lastName
          }
        }
      `;

      const queryManager = createQueryManager({
        link: mockSingleLink().setOnError(reject),
      });

      const options = {
        query,
        fetchPolicy: "cache-only",
      } as WatchQueryOptions;

      let refetchCount = 0;

      const obs = queryManager.watchQuery(options);
      obs.subscribe({});
      obs.refetch = () => {
        ++refetchCount;
        return null as never;
      };

      queryManager.reFetchObservableQueries();

      setTimeout(() => {
        expect(refetchCount).toEqual(0);
        resolve();
      }, 50);
    });

    itAsync('should not call refetch on a standby Observable if the observed queries are refetched', (resolve, reject) => {
      const query = gql`
        query {
          author {
            firstName
            lastName
          }
        }
      `;

      const queryManager = createQueryManager({
        link: mockSingleLink().setOnError(reject),
      });

      const options = {
        query,
        fetchPolicy: "standby",
      } as WatchQueryOptions;

      let refetchCount = 0;

      const obs = queryManager.watchQuery(options);
      obs.subscribe({});
      obs.refetch = () => {
        ++refetchCount;
        return null as never;
      };

      queryManager.reFetchObservableQueries();

      setTimeout(() => {
        expect(refetchCount).toEqual(0);
        resolve();
      }, 50);
    });

    itAsync('should refetch on a standby Observable if the observed queries are refetched and the includeStandby parameter is set to true', (resolve, reject) => {
      const query = gql`
        query {
          author {
            firstName
            lastName
          }
        }
      `;

      const queryManager = createQueryManager({
        link: mockSingleLink().setOnError(reject),
      });

      const options = {
        query,
        fetchPolicy: "standby",
      } as WatchQueryOptions;

      let refetchCount = 0;

      const obs = queryManager.watchQuery(options);
      obs.subscribe({});
      obs.refetch = () => {
        ++refetchCount;
        return null as never;
      };

      const includeStandBy = true;
      queryManager.reFetchObservableQueries(includeStandBy);

      setTimeout(() => {
        expect(refetchCount).toEqual(1);
        resolve();
      }, 50);
    });

    itAsync('should not call refetch on a non-subscribed Observable', (resolve, reject) => {
      const query = gql`
        query {
          author {
            firstName
            lastName
          }
        }
      `;

      const queryManager = createQueryManager({
        link: mockSingleLink().setOnError(reject),
      });

      const options = {
        query
      } as WatchQueryOptions;

      let refetchCount = 0;

      const obs = queryManager.watchQuery(options);
      obs.refetch = () => {
        ++refetchCount;
        return null as never;
      };

      queryManager.reFetchObservableQueries();

      setTimeout(() => {
        expect(refetchCount).toEqual(0);
        resolve();
      }, 50);
    });

    itAsync('should NOT throw an error on an inflight query() if the observed queries are refetched', (resolve, reject) => {
      let queryManager: QueryManager<NormalizedCacheObject>;
      const query = gql`
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
      const link = new ApolloLink(
        () =>
          new Observable(observer => {
            // refetch observed queries as soon as we hear about the query
            queryManager.reFetchObservableQueries();
            observer.next({ data });
            observer.complete();
          }),
      );

      queryManager = createQueryManager({ link });
      queryManager
        .query<any>({ query })
        .then(() => {
          resolve();
        })
        .catch(e => {
          reject(
            new Error(
              'query() should not throw error when refetching observed queriest',
            ),
          );
        });
    });
  });

  describe('refetching specified queries', () => {
    itAsync('returns a promise resolving when all queries have been refetched', (resolve, reject) => {
      const query = gql`
        query GetAuthor {
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

      const dataChanged = {
        author: {
          firstName: 'John changed',
          lastName: 'Smith',
        },
      };

      const query2 = gql`
        query GetAuthor2 {
          author2 {
            firstName
            lastName
          }
        }
      `;

      const data2 = {
        author2: {
          firstName: 'John',
          lastName: 'Smith',
        },
      };

      const data2Changed = {
        author2: {
          firstName: 'John changed',
          lastName: 'Smith',
        },
      };

      const queryManager = createQueryManager({
        link: mockSingleLink({
          request: { query },
          result: { data },
        }, {
          request: { query: query2 },
          result: { data: data2 },
        }, {
          request: { query },
          result: { data: dataChanged },
        }, {
          request: { query: query2 },
          result: { data: data2Changed },
        }).setOnError(reject),
      });

      const observable = queryManager.watchQuery<any>({ query });
      const observable2 = queryManager.watchQuery<any>({ query: query2 });

      return Promise.all([
        observableToPromise({ observable }, result =>
          expect(stripSymbols(result.data)).toEqual(data),
        ),
        observableToPromise({ observable: observable2 }, result =>
          expect(stripSymbols(result.data)).toEqual(data2),
        ),
      ]).then(() => {
        observable.subscribe({ next: () => null });
        observable2.subscribe({ next: () => null });

        const results: any[] = [];
        queryManager.refetchQueries({
          include: ['GetAuthor', 'GetAuthor2'],
        }).forEach(result => results.push(result));

        return Promise.all(results).then(() => {
          const result = getCurrentQueryResult(observable);
          expect(result.partial).toBe(false);
          expect(stripSymbols(result.data)).toEqual(dataChanged);

          const result2 = getCurrentQueryResult(observable2);
          expect(result2.partial).toBe(false);
          expect(stripSymbols(result2.data)).toEqual(data2Changed);
        });
      }).then(resolve, reject);
    });
  });

  describe('loading state', () => {
    itAsync('should be passed as false if we are not watching a query', (resolve, reject) => {
      const query = gql`
        query {
          fortuneCookie
        }
      `;
      const data = {
        fortuneCookie: 'Buy it',
      };
      return mockQueryManager(reject, {
        request: { query },
        result: { data },
      })
        .query({ query })
        .then(result => {
          expect(!result.loading).toBeTruthy();
          expect(stripSymbols(result.data)).toEqual(data);
        })
        .then(resolve, reject);
    });

    itAsync('should be passed to the observer as true if we are returning partial data', (resolve, reject) => {
      const fortuneCookie =
        'You must stick to your goal but rethink your approach';
      const primeQuery = gql`
        query {
          fortuneCookie
        }
      `;
      const primeData = { fortuneCookie };

      const author = { name: 'John' };
      const query = gql`
        query {
          fortuneCookie
          author {
            name
          }
        }
      `;
      const fullData = { fortuneCookie, author };

      const queryManager = mockQueryManager(
        reject,
        {
          request: { query },
          result: { data: fullData },
          delay: 5,
        },
        {
          request: { query: primeQuery },
          result: { data: primeData },
        },
      );

      return queryManager
        .query<any>({ query: primeQuery })
        .then(primeResult => {
          const observable = queryManager.watchQuery<any>({
            query,
            returnPartialData: true,
          });

          return observableToPromise(
            { observable },
            result => {
              expect(result.loading).toBe(true);
              expect(result.data).toEqual(primeData);
            },
            result => {
              expect(result.loading).toBe(false);
              expect(result.data).toEqual(fullData);
            },
          );
        })
        .then(resolve, reject);
    });

    itAsync('should be passed to the observer as false if we are returning all the data', (resolve, reject) => {
      assertWithObserver({
        reject,
        query: gql`
          query {
            author {
              firstName
              lastName
            }
          }
        `,
        result: {
          data: {
            author: {
              firstName: 'John',
              lastName: 'Smith',
            },
          },
        },
        observer: {
          next(result) {
            expect(!result.loading).toBeTruthy();
            resolve();
          },
        },
      });
    });

    itAsync('will update on `resetStore`', (resolve, reject) => {
      const testQuery = gql`
        query {
          author {
            firstName
            lastName
          }
        }
      `;
      const data1 = {
        author: {
          firstName: 'John',
          lastName: 'Smith',
        },
      };
      const data2 = {
        author: {
          firstName: 'John',
          lastName: 'Smith 2',
        },
      };
      const queryManager = mockQueryManager(
        reject,
        {
          request: { query: testQuery },
          result: { data: data1 },
        },
        {
          request: { query: testQuery },
          result: { data: data2 },
        },
      );
      let count = 0;

      queryManager
        .watchQuery({
          query: testQuery,
          notifyOnNetworkStatusChange: false,
        })
        .subscribe({
          next: result => {
            switch (count++) {
              case 0:
                expect(result.loading).toBe(false);
                expect(stripSymbols(result.data)).toEqual(data1);
                setTimeout(() => {
                  queryManager.resetStore();
                }, 0);
                break;
              case 1:
                expect(result.loading).toBe(false);
                expect(stripSymbols(result.data)).toEqual(data2);
                resolve();
                break;
              default:
                reject(new Error('`next` was called to many times.'));
            }
          },
          error: error => reject(error),
        });
    });

    itAsync('will be true when partial data may be returned', (resolve, reject) => {
      const query1 = gql`{
        a { x1 y1 z1 }
      }`;
      const query2 = gql`{
        a { x1 y1 z1 }
        b { x2 y2 z2 }
      }`;
      const data1 = {
        a: { x1: 1, y1: 2, z1: 3 },
      };
      const data2 = {
        a: { x1: 1, y1: 2, z1: 3 },
        b: { x2: 3, y2: 2, z2: 1 },
      };
      const queryManager = mockQueryManager(
        reject,
        {
          request: { query: query1 },
          result: { data: data1 },
        },
        {
          request: { query: query2 },
          result: { data: data2 },
          delay: 5,
        },
      );

      queryManager
        .query({ query: query1 })
        .then(result1 => {
          expect(result1.loading).toBe(false);
          expect(result1.data).toEqual(data1);

          let count = 0;
          queryManager
            .watchQuery({ query: query2, returnPartialData: true })
            .subscribe({
              next: result2 => {
                switch (count++) {
                  case 0:
                    expect(result2.loading).toBe(true);
                    expect(result2.data).toEqual(data1);
                    break;
                  case 1:
                    expect(result2.loading).toBe(false);
                    expect(result2.data).toEqual(data2);
                    resolve();
                    break;
                  default:
                    reject(new Error('`next` was called to many times.'));
                }
              },
              error: reject,
            });
        }).then(resolve, reject);
    });
  });

  describe('refetchQueries', () => {
    let consoleWarnSpy: jest.SpyInstance;
    beforeEach(() => {
      consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();
    });
    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    itAsync('should refetch the right query when a result is successfully returned', (resolve, reject) => {
      const mutation = gql`
        mutation changeAuthorName {
          changeAuthorName(newName: "Jack Smith") {
            firstName
            lastName
          }
        }
      `;
      const mutationData = {
        changeAuthorName: {
          firstName: 'Jack',
          lastName: 'Smith',
        },
      };
      const query = gql`
        query getAuthors($id: ID!) {
          author(id: $id) {
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
      const secondReqData = {
        author: {
          firstName: 'Jane',
          lastName: 'Johnson',
        },
      };
      const variables = { id: '1234' };
      const queryManager = mockQueryManager(
        reject,
        {
          request: { query, variables },
          result: { data },
        },
        {
          request: { query, variables },
          result: { data: secondReqData },
        },
        {
          request: { query: mutation },
          result: { data: mutationData },
        },
      );
      const observable = queryManager.watchQuery<any>({
        query,
        variables,
        notifyOnNetworkStatusChange: false,
      });
      return observableToPromise(
        { observable },
        result => {
          expect(stripSymbols(result.data)).toEqual(data);
          queryManager.mutate({ mutation, refetchQueries: ['getAuthors'] });
        },
        result => {
          expect(stripSymbols(observable.getCurrentResult().data)).toEqual(
            secondReqData,
          );
          expect(stripSymbols(result.data)).toEqual(secondReqData);
        },
      ).then(resolve, reject);
    });

    itAsync('should not warn and continue when an unknown query name is asked to refetch', (resolve, reject) => {
      const mutation = gql`
        mutation changeAuthorName {
          changeAuthorName(newName: "Jack Smith") {
            firstName
            lastName
          }
        }
      `;
      const mutationData = {
        changeAuthorName: {
          firstName: 'Jack',
          lastName: 'Smith',
        },
      };
      const query = gql`
        query getAuthors {
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
      const secondReqData = {
        author: {
          firstName: 'Jane',
          lastName: 'Johnson',
        },
      };
      const queryManager = mockQueryManager(
        reject,
        {
          request: { query },
          result: { data },
        },
        {
          request: { query },
          result: { data: secondReqData },
        },
        {
          request: { query: mutation },
          result: { data: mutationData },
        },
      );
      const observable = queryManager.watchQuery<any>({
        query,
        notifyOnNetworkStatusChange: false,
      });
      return observableToPromise(
        { observable },
        result => {
          expect(stripSymbols(result.data)).toEqual(data);
          queryManager.mutate({
            mutation,
            refetchQueries: ['fakeQuery', 'getAuthors'],
          });
        },
        result => {
          expect(stripSymbols(result.data)).toEqual(secondReqData);
          expect(consoleWarnSpy).toHaveBeenLastCalledWith(
            'Unknown query named "fakeQuery" requested in refetchQueries options.include array'
          );
        },
      ).then(resolve, reject);
    });

    itAsync('should ignore (with warning) a query named in refetchQueries that has no active subscriptions', (resolve, reject) => {
      const mutation = gql`
        mutation changeAuthorName {
          changeAuthorName(newName: "Jack Smith") {
            firstName
            lastName
          }
        }
      `;
      const mutationData = {
        changeAuthorName: {
          firstName: 'Jack',
          lastName: 'Smith',
        },
      };
      const query = gql`
        query getAuthors {
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
      const secondReqData = {
        author: {
          firstName: 'Jane',
          lastName: 'Johnson',
        },
      };
      const queryManager = mockQueryManager(
        reject,
        {
          request: { query },
          result: { data },
        },
        {
          request: { query },
          result: { data: secondReqData },
        },
        {
          request: { query: mutation },
          result: { data: mutationData },
        },
      );

      const observable = queryManager.watchQuery<any>({ query });
      return observableToPromise({ observable }, result => {
        expect(stripSymbols(result.data)).toEqual(data);
      }).then(() => {
        // The subscription has been stopped already
        return queryManager.mutate({
          mutation,
          refetchQueries: ['getAuthors'],
        });
      }).then(() => {
        expect(consoleWarnSpy).toHaveBeenLastCalledWith(
          'Unknown query named "getAuthors" requested in refetchQueries options.include array'
        );
      }).then(resolve, reject);
    });

    itAsync('also works with a query document and variables', (resolve, reject) => {
      const mutation = gql`
        mutation changeAuthorName($id: ID!) {
          changeAuthorName(newName: "Jack Smith", id: $id) {
            firstName
            lastName
          }
        }
      `;
      const mutationData = {
        changeAuthorName: {
          firstName: 'Jack',
          lastName: 'Smith',
        },
      };
      const query = gql`
        query getAuthors($id: ID!) {
          author(id: $id) {
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
      const secondReqData = {
        author: {
          firstName: 'Jane',
          lastName: 'Johnson',
        },
      };

      const variables = { id: '1234' };
      const mutationVariables = { id: '2345' };
      const queryManager = mockQueryManager(
        reject,
        {
          request: { query, variables },
          result: { data },
          delay: 10,
        },
        {
          request: { query, variables },
          result: { data: secondReqData },
          delay: 100,
        },
        {
          request: { query: mutation, variables: mutationVariables },
          result: { data: mutationData },
          delay: 10,
        },
      );
      const observable = queryManager.watchQuery<any>({ query, variables });

      subscribeAndCount(reject, observable, (count, result) => {
        if (count === 1) {
          expect(result.data).toEqual(data);
          queryManager.mutate({
            mutation,
            variables: mutationVariables,
            refetchQueries: [{ query, variables }],
          });
        } else if (count === 2) {
          expect(result.data).toEqual(secondReqData);
          expect(observable.getCurrentResult().data).toEqual(secondReqData);

          return new Promise(res => setTimeout(res, 10)).then(() => {
            // Make sure the QueryManager cleans up legacy one-time queries like
            // the one we requested above using refetchQueries.
            queryManager["queries"].forEach((queryInfo, queryId) => {
              expect(queryId).not.toContain("legacyOneTimeQuery");
            });
          }).then(resolve, reject);
        } else {
          reject("too many results");
        }
      });
    });

    itAsync('also works with a conditional function that returns false', (resolve, reject) => {
      const mutation = gql`
        mutation changeAuthorName {
          changeAuthorName(newName: "Jack Smith") {
            firstName
            lastName
          }
        }
      `;
      const mutationData = {
        changeAuthorName: {
          firstName: 'Jack',
          lastName: 'Smith',
        },
      };
      const query = gql`
        query getAuthors {
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
      const secondReqData = {
        author: {
          firstName: 'Jane',
          lastName: 'Johnson',
        },
      };
      const queryManager = mockQueryManager(
        reject,
        {
          request: { query },
          result: { data },
        },
        {
          request: { query },
          result: { data: secondReqData },
        },
        {
          request: { query: mutation },
          result: { data: mutationData },
        },
      );
      const observable = queryManager.watchQuery<any>({ query });
      const conditional = (result: FetchResult<any>) => {
        expect(stripSymbols(result.data)).toEqual(mutationData);
        return [];
      };

      return observableToPromise({ observable }, result => {
        expect(stripSymbols(result.data)).toEqual(data);
        queryManager.mutate({ mutation, refetchQueries: conditional });
      }).then(resolve, reject);
    });

    itAsync('also works with a conditional function that returns an array of refetches', (resolve, reject) => {
      const mutation = gql`
        mutation changeAuthorName {
          changeAuthorName(newName: "Jack Smith") {
            firstName
            lastName
          }
        }
      `;
      const mutationData = {
        changeAuthorName: {
          firstName: 'Jack',
          lastName: 'Smith',
        },
      };
      const query = gql`
        query getAuthors {
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
      const secondReqData = {
        author: {
          firstName: 'Jane',
          lastName: 'Johnson',
        },
      };
      const queryManager = mockQueryManager(
        reject,
        {
          request: { query },
          result: { data },
        },
        {
          request: { query },
          result: { data: secondReqData },
        },
        {
          request: { query: mutation },
          result: { data: mutationData },
        },
      );
      const observable = queryManager.watchQuery<any>({ query });
      const conditional = (result: FetchResult<any>) => {
        expect(stripSymbols(result.data)).toEqual(mutationData);
        return [{ query }];
      };

      return observableToPromise(
        { observable },
        result => {
          expect(stripSymbols(result.data)).toEqual(data);
          queryManager.mutate({ mutation, refetchQueries: conditional });
        },
        result => expect(stripSymbols(result.data)).toEqual(secondReqData),
      ).then(resolve, reject);
    });

    itAsync('should refetch using the original query context (if any)', (resolve, reject) => {
      const mutation = gql`
        mutation changeAuthorName {
          changeAuthorName(newName: "Jack Smith") {
            firstName
            lastName
          }
        }
      `;
      const mutationData = {
        changeAuthorName: {
          firstName: 'Jack',
          lastName: 'Smith',
        },
      };
      const query = gql`
        query getAuthors($id: ID!) {
          author(id: $id) {
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
      const secondReqData = {
        author: {
          firstName: 'Jane',
          lastName: 'Johnson',
        },
      };
      const variables = { id: '1234' };
      const queryManager = mockQueryManager(
        reject,
        {
          request: { query, variables },
          result: { data },
        },
        {
          request: { query, variables },
          result: { data: secondReqData },
        },
        {
          request: { query: mutation },
          result: { data: mutationData },
        },
      );

      const headers = {
        someHeader: 'some value',
      };
      const observable = queryManager.watchQuery<any>({
        query,
        variables,
        context: {
          headers,
        },
        notifyOnNetworkStatusChange: false,
      });

      return observableToPromise(
        { observable },
        result => {
          queryManager.mutate({
            mutation,
            refetchQueries: ['getAuthors'],
          });
        },
        result => {
          const context = (queryManager.link as MockApolloLink).operation!.getContext();
          expect(context.headers).not.toBeUndefined();
          expect(context.headers.someHeader).toEqual(headers.someHeader);
        },
      ).then(resolve, reject);
    });

    itAsync('should refetch using the specified context, if provided', (resolve, reject) => {
      const mutation = gql`
        mutation changeAuthorName {
          changeAuthorName(newName: "Jack Smith") {
            firstName
            lastName
          }
        }
      `;
      const mutationData = {
        changeAuthorName: {
          firstName: 'Jack',
          lastName: 'Smith',
        },
      };
      const query = gql`
        query getAuthors($id: ID!) {
          author(id: $id) {
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
      const secondReqData = {
        author: {
          firstName: 'Jane',
          lastName: 'Johnson',
        },
      };
      const variables = { id: '1234' };
      const queryManager = mockQueryManager(
        reject,
        {
          request: { query, variables },
          result: { data },
        },
        {
          request: { query, variables },
          result: { data: secondReqData },
        },
        {
          request: { query: mutation },
          result: { data: mutationData },
        },
      );

      const observable = queryManager.watchQuery<any>({
        query,
        variables,
        notifyOnNetworkStatusChange: false,
      });

      const headers = {
        someHeader: 'some value',
      };

      return observableToPromise(
        { observable },
        result => {
          queryManager.mutate({
            mutation,
            refetchQueries: [
              {
                query,
                variables,
                context: {
                  headers,
                },
              },
            ],
          });
        },
        result => {
          const context = (queryManager.link as MockApolloLink).operation!.getContext();
          expect(context.headers).not.toBeUndefined();
          expect(context.headers.someHeader).toEqual(headers.someHeader);
        },
      ).then(resolve, reject);
    });
  });

  describe('onQueryUpdated', () => {
    const mutation = gql`
      mutation changeAuthorName {
        changeAuthorName(newName: "Jack Smith") {
          firstName
          lastName
        }
      }
    `;

    const mutationData = {
      changeAuthorName: {
        firstName: 'Jack',
        lastName: 'Smith',
      },
    };

    const query = gql`
      query getAuthors($id: ID!) {
        author(id: $id) {
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

    const secondReqData = {
      author: {
        firstName: 'Jane',
        lastName: 'Johnson',
      },
    };

    const variables = { id: '1234' };

    function makeQueryManager(reject: (reason?: any) => void) {
      return mockQueryManager(
        reject,
        {
          request: { query, variables },
          result: { data },
        },
        {
          request: { query, variables },
          result: { data: secondReqData },
        },
        {
          request: { query: mutation },
          result: { data: mutationData },
        },
      );
    }

    itAsync('should refetch the right query when a result is successfully returned', (resolve, reject) => {
      const queryManager = makeQueryManager(reject);

      const observable = queryManager.watchQuery<any>({
        query,
        variables,
        notifyOnNetworkStatusChange: false,
      });

      let finishedRefetch = false;

      return observableToPromise(
        { observable },
        result => {
          expect(stripSymbols(result.data)).toEqual(data);

          return queryManager.mutate({
            mutation,

            update(cache) {
              cache.modify({
                fields: {
                  author(_, { INVALIDATE }) {
                    return INVALIDATE;
                  },
                },
              });
            },

            onQueryUpdated(obsQuery) {
              expect(obsQuery.options.query).toBe(query);
              return obsQuery.refetch().then(async (result) => {
                // Wait a bit to make sure the mutation really awaited the
                // refetching of the query.
                await new Promise(resolve => setTimeout(resolve, 100));
                finishedRefetch = true;
                return result;
              });
            },
          }).then(() => {
            expect(finishedRefetch).toBe(true);
          });
        },

        result => {
          expect(stripSymbols(observable.getCurrentResult().data)).toEqual(
            secondReqData,
          );
          expect(stripSymbols(result.data)).toEqual(secondReqData);
          expect(finishedRefetch).toBe(true);
        },
      ).then(resolve, reject);
    });

    itAsync('should refetch using the original query context (if any)', (resolve, reject) => {
      const queryManager = makeQueryManager(reject);

      const headers = {
        someHeader: 'some value',
      };

      const observable = queryManager.watchQuery<any>({
        query,
        variables,
        context: {
          headers,
        },
        notifyOnNetworkStatusChange: false,
      });

      return observableToPromise(
        { observable },
        result => {
          expect(result.data).toEqual(data);

          queryManager.mutate({
            mutation,

            update(cache) {
              cache.modify({
                fields: {
                  author(_, { INVALIDATE }) {
                    return INVALIDATE;
                  },
                },
              });
            },

            onQueryUpdated(obsQuery) {
              expect(obsQuery.options.query).toBe(query);
              return obsQuery.refetch();
            },
          });
        },

        result => {
          expect(result.data).toEqual(secondReqData);
          const context = (queryManager.link as MockApolloLink).operation!.getContext();
          expect(context.headers).not.toBeUndefined();
          expect(context.headers.someHeader).toEqual(headers.someHeader);
        },
      ).then(resolve, reject);
    });

    itAsync('should refetch using the specified context, if provided', (resolve, reject) => {
      const queryManager = makeQueryManager(reject);

      const observable = queryManager.watchQuery<any>({
        query,
        variables,
        notifyOnNetworkStatusChange: false,
      });

      const headers = {
        someHeader: 'some value',
      };

      return observableToPromise(
        { observable },
        result => {
          expect(result.data).toEqual(data);

          queryManager.mutate({
            mutation,

            update(cache) {
              cache.evict({ fieldName: "author" });
            },

            onQueryUpdated(obsQuery) {
              expect(obsQuery.options.query).toBe(query);
              return obsQuery.reobserve({
                fetchPolicy: "network-only",
                context: {
                  ...obsQuery.options.context,
                  headers,
                },
              });
            },
          });
        },

        result => {
          expect(result.data).toEqual(secondReqData);
          const context = (queryManager.link as MockApolloLink).operation!.getContext();
          expect(context.headers).not.toBeUndefined();
          expect(context.headers.someHeader).toEqual(headers.someHeader);
        },
      ).then(resolve, reject);
    });
  });

  describe('awaitRefetchQueries', () => {
    const awaitRefetchTest =
    ({ awaitRefetchQueries, testQueryError = false }: MutationBaseOptions<any, any, any> & { testQueryError?: boolean }) =>
    new Promise<void>((resolve, reject) => {
      const query = gql`
        query getAuthors($id: ID!) {
          author(id: $id) {
            firstName
            lastName
          }
        }
      `;

      const queryData = {
        author: {
          firstName: 'John',
          lastName: 'Smith',
        },
      };

      const mutation = gql`
        mutation changeAuthorName {
          changeAuthorName(newName: "Jack Smith") {
            firstName
            lastName
          }
        }
      `;

      const mutationData = {
        changeAuthorName: {
          firstName: 'Jack',
          lastName: 'Smith',
        },
      };

      const secondReqData = {
        author: {
          firstName: 'Jane',
          lastName: 'Johnson',
        },
      };

      const variables = { id: '1234' };

      const refetchError = testQueryError ? new Error('Refetch failed') : undefined;

      const queryManager = mockQueryManager(
        reject,
        {
          request: { query, variables },
          result: { data: queryData },
        },
        {
          request: { query: mutation },
          result: { data: mutationData },
        },
        {
          request: { query, variables },
          result: { data: secondReqData },
          error: refetchError,
        },
      );

      const observable = queryManager.watchQuery<any>({
        query,
        variables,
        notifyOnNetworkStatusChange: false,
      });

      let isRefetchErrorCaught = false;
      let mutationComplete = false;
      return observableToPromise(
        { observable },
        result => {
          expect(stripSymbols(result.data)).toEqual(queryData);
          const mutateOptions: MutationOptions<any, any, any> = {
            mutation,
            refetchQueries: ['getAuthors'],
          };
          if (awaitRefetchQueries) {
            mutateOptions.awaitRefetchQueries = awaitRefetchQueries;
          }
          queryManager.mutate(mutateOptions).then(() => {
            mutationComplete = true;
          })
          .catch(error => {
            expect(error).toBeDefined();
            isRefetchErrorCaught = true;
          });
        },
        result => {
          if (awaitRefetchQueries) {
            expect(mutationComplete).not.toBeTruthy();
          } else {
            expect(mutationComplete).toBeTruthy();
          }
          expect(stripSymbols(observable.getCurrentResult().data)).toEqual(
            secondReqData,
          );
          expect(stripSymbols(result.data)).toEqual(secondReqData);
        },
      )
      .then(() => resolve())
      .catch(error => {
        const isRefetchError = awaitRefetchQueries && testQueryError &&
          error.message.includes(refetchError?.message);

        if (isRefetchError) {
          return setTimeout(() => {
            expect(isRefetchErrorCaught).toBe(true);
            resolve();
          }, 10);
        }

        reject(error);
      });
    });

    it(
      'should not wait for `refetchQueries` to complete before resolving ' +
        'the mutation, when `awaitRefetchQueries` is undefined',
      () => awaitRefetchTest({ awaitRefetchQueries: void 0 })
    );

    it(
      'should not wait for `refetchQueries` to complete before resolving ' +
        'the mutation, when `awaitRefetchQueries` is false',
      () => awaitRefetchTest({ awaitRefetchQueries: false })
    );

    it(
      'should wait for `refetchQueries` to complete before resolving ' +
        'the mutation, when `awaitRefetchQueries` is `true`',
      () => awaitRefetchTest({ awaitRefetchQueries: true })
    );

    it(
      'should allow catching errors from `refetchQueries` when ' +
        '`awaitRefetchQueries` is `true`',
      () => awaitRefetchTest({ awaitRefetchQueries: true, testQueryError: true })
    )
  });

  describe('store watchers', () => {
    itAsync('does not fill up the store on resolved queries', (resolve, reject) => {
      const query1 = gql`
        query One {
          one
        }
      `;
      const query2 = gql`
        query Two {
          two
        }
      `;
      const query3 = gql`
        query Three {
          three
        }
      `;
      const query4 = gql`
        query Four {
          four
        }
      `;

      const link = mockSingleLink(
        { request: { query: query1 }, result: { data: { one: 1 } } },
        { request: { query: query2 }, result: { data: { two: 2 } } },
        { request: { query: query3 }, result: { data: { three: 3 } } },
        { request: { query: query4 }, result: { data: { four: 4 } } }
      ).setOnError(reject);
      const cache = new InMemoryCache();

      const queryManager = new QueryManager<NormalizedCacheObject>({
        link,
        cache,
      });

      return queryManager
        .query({ query: query1 })
        .then(one => {
          return queryManager.query({ query: query2 });
        })
        .then(() => {
          return queryManager.query({ query: query3 });
        })
        .then(() => {
          return queryManager.query({ query: query4 });
        })
        .then(() => {
          return new Promise(r => {
            setTimeout(r, 10);
          });
        })
        .then(() => {
          // @ts-ignore
          expect(cache.watches.size).toBe(0);
        })
        .then(resolve, reject);
    });
  });

  describe('`no-cache` handling', () => {
    itAsync(
      'should return a query result (if one exists) when a `no-cache` fetch policy is used',
      (resolve, reject) => {
        const query = gql`
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

        const queryManager = createQueryManager({
          link: mockSingleLink({
            request: { query },
            result: { data },
          }).setOnError(reject),
        });

        const observable = queryManager.watchQuery<any>({
          query,
          fetchPolicy: 'no-cache',
        });
        observableToPromise({ observable }, result => {
          expect(stripSymbols(result.data)).toEqual(data);
          const currentResult = getCurrentQueryResult(observable);
          expect(currentResult.data).toEqual(data);
          resolve();
        });
      },
    );
  });

  describe('client awareness', () => {
    itAsync('should pass client awareness settings into the link chain via context', (resolve, reject) => {
      const query = gql`
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

      const link = mockSingleLink({
        request: { query },
        result: { data },
      }).setOnError(reject);

      const clientAwareness = {
        name: 'Test',
        version: '1.0.0',
      };

      const queryManager = createQueryManager({
        link,
        clientAwareness,
      });

      const observable = queryManager.watchQuery<any>({
        query,
        fetchPolicy: 'no-cache',
      });

      observableToPromise({ observable }, result => {
        const context = link.operation!.getContext();
        expect(context.clientAwareness).toBeDefined();
        expect(context.clientAwareness).toEqual(clientAwareness);
        resolve();
      });
    });
  });

  describe('queryDeduplication', () => {
    it('should be true when context is true, default is false and argument not provided', () => {
      const query = gql`
        query {
          author {
            firstName
          }
        }
      `;
      const queryManager = createQueryManager({
        link: mockSingleLink({
          request: { query },
          result: {
            data: {
              author: { firstName: 'John' },
            },
          },
        }),
      });

      queryManager.query({ query, context: { queryDeduplication: true } })

      expect(queryManager['inFlightLinkObservables'].size).toBe(1)
    });

    it('should allow overriding global queryDeduplication: true to false', () => {
      const query = gql`
        query {
          author {
            firstName
          }
        }
      `;

      const queryManager = createQueryManager({
        link: mockSingleLink({
          request: { query },
          result: {
            data: {
              author: { firstName: 'John' },
            },
          },
        }),
        queryDeduplication: true,
      });

      queryManager.query({ query, context: { queryDeduplication: false } })

      expect(queryManager['inFlightLinkObservables'].size).toBe(0)
    });
  });

  describe('missing cache field warnings', () => {
    let verbosity: ReturnType<typeof setVerbosity>;
    let spy: any;
    beforeEach(() => {
      verbosity = setVerbosity("debug");
      spy = jest.spyOn(console, "debug").mockImplementation();
    });

    afterEach(() => {
      setVerbosity(verbosity);
      spy.mockRestore();
    });

    function validateWarnings(
      resolve: (result?: any) => void,
      reject: (reason?: any) => void,
      returnPartialData = false,
      expectedWarnCount = 1
    ) {
      const query1 = gql`
        query {
          car {
            make
            model
            id
            __typename
          }
        }
      `;

      const query2 = gql`
        query {
          car {
            make
            model
            vin
            id
            __typename
          }
        }
      `;

      const data1 = {
        car: {
          make: 'Ford',
          model: 'Pinto',
          id: 123,
          __typename: 'Car'
        },
      };

      const queryManager = mockQueryManager(
        reject,
        {
          request: { query: query1 },
          result: { data: data1 },
        },
      );

      const observable1 = queryManager.watchQuery<any>({ query: query1 });
      const observable2 = queryManager.watchQuery<any>({
        query: query2,
        fetchPolicy: 'cache-only',
        returnPartialData,
      });

      return observableToPromise(
        { observable: observable1 },
        result => {
          expect(result).toEqual({
            loading: false,
            data: data1,
            networkStatus: NetworkStatus.ready,
          });
        },
      ).then(() => {
        observableToPromise(
          { observable: observable2 },
          result => {
            expect(result).toEqual({
              data: data1,
              loading: false,
              networkStatus: NetworkStatus.ready,
              partial: true,
            });
            expect(spy).toHaveBeenCalledTimes(expectedWarnCount);
          },
        ).then(resolve, reject)
      });
    }

    itAsync('should show missing cache result fields warning when returnPartialData is false', (resolve, reject) => {
      validateWarnings(resolve, reject, false, 1);
    });

    itAsync('should not show missing cache result fields warning when returnPartialData is true', (resolve, reject) => {
      validateWarnings(resolve, reject, true, 0);
    });
  });
});
