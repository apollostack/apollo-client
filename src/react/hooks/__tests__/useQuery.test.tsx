import { DocumentNode, GraphQLError } from 'graphql';
import gql from 'graphql-tag';
import { render, cleanup, wait } from '@testing-library/react';

import { Observable } from '../../../utilities/observables/Observable';
import { ApolloLink } from '../../../link/core/ApolloLink';
import { MockedProvider, mockSingleLink } from '../../../utilities/testing';
import { MockLink } from '../../../utilities/testing/mocking/mockLink';
import { itAsync } from '../../../utilities/testing/itAsync';
import { ApolloClient } from '../../../ApolloClient';
import { InMemoryCache } from '../../../cache/inmemory/inMemoryCache';
import { ApolloProvider } from '../../context/ApolloProvider';
import { useQuery } from '../useQuery';
import { requireReactLazily } from '../../react';
import type { QueryFunctionOptions } from '../..';
import { NetworkStatus } from '../../../core/networkStatus';

const React = requireReactLazily();
const { useState, useReducer, Fragment } = React;

describe('useQuery Hook', () => {
  const CAR_QUERY: DocumentNode = gql`
    query {
      cars {
        make
        model
        vin
      }
    }
  `;

  const CAR_RESULT_DATA = {
    cars: [
      {
        make: 'Audi',
        model: 'RS8',
        vin: 'DOLLADOLLABILL',
        __typename: 'Car'
      }
    ]
  };

  const CAR_MOCKS = [
    {
      request: {
        query: CAR_QUERY
      },
      result: { data: CAR_RESULT_DATA }
    }
  ];

  afterEach(cleanup);

  describe('General use', () => {
    itAsync('should handle a simple query properly', (resolve, reject) => {
      const Component = () => {
        const { data, loading } = useQuery(CAR_QUERY);
        if (!loading) {
          expect(data).toEqual(CAR_RESULT_DATA);
        }
        return null;
      };

      render(
        <MockedProvider mocks={CAR_MOCKS}>
          <Component />
        </MockedProvider>
      );

      return wait().then(resolve, reject);
    });

    itAsync('should keep data as undefined until data is actually returned', (resolve, reject) => {
      const Component = () => {
        const { data, loading } = useQuery(CAR_QUERY);
        if (loading) {
          expect(data).toBeUndefined();
        } else {
          expect(data).toEqual(CAR_RESULT_DATA);
        }
        return null;
      };

      render(
        <MockedProvider mocks={CAR_MOCKS}>
          <Component />
        </MockedProvider>
      );

      return wait().then(resolve, reject);
    });

    itAsync('should return a result upon first call, if data is available', async (resolve, reject) => {
      // This test verifies that the `useQuery` hook returns a result upon its first
      // invocation if the data is available in the cache. This is essential for SSR
      // to work properly, since effects are not run during SSR.

      const Component = ({ expectData }: { expectData: boolean }) => {
        const { data } = useQuery(CAR_QUERY);
        if (expectData) {
          expect(data).toEqual(CAR_RESULT_DATA);
        }
        return null;
      };

      // Common cache instance to use across render passes.
      // The cache will be warmed with the result of the query on the second pass.
      const cache = new InMemoryCache();

      render(
        <MockedProvider mocks={CAR_MOCKS} cache={cache}>
          <Component expectData={false} />
        </MockedProvider>
      );

      await wait();

      render(
        <MockedProvider mocks={CAR_MOCKS} cache={cache}>
          <Component expectData={true} />
        </MockedProvider>
      );

      return wait().then(resolve, reject);
    });

    itAsync('should ensure ObservableQuery fields have a stable identity', (resolve, reject) => {
      let refetchFn: any;
      let fetchMoreFn: any;
      let updateQueryFn: any;
      let startPollingFn: any;
      let stopPollingFn: any;
      let subscribeToMoreFn: any;
      const Component = () => {
        const {
          loading,
          refetch,
          fetchMore,
          updateQuery,
          startPolling,
          stopPolling,
          subscribeToMore
        } = useQuery(CAR_QUERY);
        if (loading) {
          refetchFn = refetch;
          fetchMoreFn = fetchMore;
          updateQueryFn = updateQuery;
          startPollingFn = startPolling;
          stopPollingFn = stopPolling;
          subscribeToMoreFn = subscribeToMore;
        } else {
          expect(refetch).toBe(refetchFn);
          expect(fetchMore).toBe(fetchMoreFn);
          expect(updateQuery).toBe(updateQueryFn);
          expect(startPolling).toBe(startPollingFn);
          expect(stopPolling).toBe(stopPollingFn);
          expect(subscribeToMore).toBe(subscribeToMoreFn);
        }
        return null;
      };

      render(
        <MockedProvider mocks={CAR_MOCKS}>
          <Component />
        </MockedProvider>
      );

      return wait().then(resolve, reject);
    });

    itAsync('should update result when query result change', async (resolve, reject) => {
      const CAR_QUERY_BY_ID = gql`
        query($id: Int) {
          car(id: $id) {
            make
            model
          }
        }
      `;

      const CAR_DATA_A4 = {
        car: {
          make: 'Audi',
          model: 'A4',
          __typename: 'Car',
        },
      };

      const CAR_DATA_RS8 = {
        car: {
          make: 'Audi',
          model: 'RS8',
          __typename: 'Car',
        },
      };

      const mocks = [
        {
          request: { query: CAR_QUERY_BY_ID, variables: { id: 1 } },
          result: { data: CAR_DATA_A4 },
        },
        {
          request: { query: CAR_QUERY_BY_ID, variables: { id: 2 } },
          result: { data: CAR_DATA_RS8 },
        },
      ];

      const hookResponse = jest.fn().mockReturnValue(null);

      function Component({ id, children }: any) {
        const { data, loading, error } = useQuery(CAR_QUERY_BY_ID, {
          variables: { id },
        });

        return children({ data, loading, error });
      }

      const { rerender } = render(
        <MockedProvider mocks={mocks}>
          <Component id={1}>{hookResponse}</Component>
        </MockedProvider>
      );

      await wait(() => {
        expect(hookResponse).toHaveBeenLastCalledWith({
          data: CAR_DATA_A4,
          loading: false,
          error: undefined,
        })
      });

      rerender(
        <MockedProvider mocks={mocks}>
          <Component id={2}>{hookResponse}</Component>
        </MockedProvider>
      );

      await wait(() => {
        expect(hookResponse).toHaveBeenLastCalledWith({
          data: CAR_DATA_RS8,
          loading: false,
          error: undefined,
        });
      });

      resolve();
    });

    itAsync('should return result when result is equivalent', async (resolve, reject) => {
      const CAR_QUERY_BY_ID = gql`
        query($id: Int) {
          car(id: $id) {
            make
            model
          }
        }
      `;

      const CAR_DATA_A4 = {
        car: {
          make: 'Audi',
          model: 'A4',
          __typename: 'Car',
        },
      };

      const mocks = [
        {
          request: { query: CAR_QUERY_BY_ID, variables: { id: 1 } },
          result: { data: CAR_DATA_A4 },
        },
        {
          request: { query: CAR_QUERY_BY_ID, variables: { id: 2 } },
          result: { data: CAR_DATA_A4 },
        },
      ];

      const hookResponse = jest.fn().mockReturnValue(null);

      function Component({ id, children, skip = false }: any) {
        const { data, loading, error } = useQuery(CAR_QUERY_BY_ID, {
          variables: { id },
          skip,
        });

        return children({ data, loading, error });
      }

      const { rerender } = render(
        <MockedProvider mocks={mocks}>
          <Component id={1}>{hookResponse}</Component>
        </MockedProvider>
      );

      await wait(() => {
        expect(hookResponse).toHaveBeenLastCalledWith({
          data: CAR_DATA_A4,
          loading: false,
          error: undefined,
        })
      });

      rerender(
        <MockedProvider mocks={mocks}>
          <Component id={2} skip>
            {hookResponse}
          </Component>
        </MockedProvider>
      );

      hookResponse.mockClear();

      rerender(
        <MockedProvider mocks={mocks}>
          <Component id={2}>{hookResponse}</Component>
        </MockedProvider>
      );

      await wait(() => {
        expect(hookResponse).toHaveBeenLastCalledWith({
          data: CAR_DATA_A4,
          loading: false,
          error: undefined,
        })
      });

      resolve();
    });

    itAsync('should not error when forcing an update with React >= 16.13.0', (resolve, reject) => {
      let wasUpdateErrorLogged = false;
      const consoleError = console.error;
      console.error = (msg: string) => {
        console.log(msg);
        wasUpdateErrorLogged = msg.indexOf('Cannot update a component') > -1;
      };

      const CAR_MOCKS = [1, 2, 3, 4, 5, 6].map(something => ({
        request: {
          query: CAR_QUERY,
          variables: { something }
        },
        result: { data: CAR_RESULT_DATA },
        delay: 1000
      }));

      let renderCount = 0;

      const InnerComponent = ({ something }: any) => {
        const { loading, data } = useQuery(CAR_QUERY, {
          fetchPolicy: 'network-only',
          variables: { something }
        });
        renderCount += 1;
        if (loading) return null;
        expect(wasUpdateErrorLogged).toBeFalsy();
        expect(data).toEqual(CAR_RESULT_DATA);
        return null;
      };

      function WrapperComponent({ something }: any) {
        const { loading } = useQuery(CAR_QUERY, {
          variables: { something }
        });
        return loading ? null : <InnerComponent something={something + 1} />;
      }

      render(
        <MockedProvider link={new MockLink(CAR_MOCKS).setOnError(reject)}>
          <Fragment>
            <WrapperComponent something={1} />
            <WrapperComponent something={3} />
            <WrapperComponent something={5} />
          </Fragment>
        </MockedProvider>
      );

      wait(() => {
        expect(renderCount).toBe(3);
      }).finally(() => {
        console.error = consoleError;
      }).then(resolve, reject);
    });
  });

  describe('Polling', () => {
    itAsync('should support polling', (resolve, reject) => {
      let renderCount = 0;
      const Component = () => {
        let { data, loading, networkStatus, stopPolling } = useQuery(CAR_QUERY, {
          pollInterval: 10
        });

        switch (++renderCount) {
          case 1:
            expect(loading).toBeTruthy();
            expect(networkStatus).toBe(NetworkStatus.loading);
            break;
          case 2:
            expect(loading).toBeFalsy();
            expect(data).toEqual(CAR_RESULT_DATA);
            expect(networkStatus).toBe(NetworkStatus.ready);
            stopPolling();
            break;
          default:
            throw new Error('Uh oh - we should have stopped polling!');
        }

        return null;
      };

      render(
        <MockedProvider mocks={CAR_MOCKS}>
          <Component />
        </MockedProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(2);
      }).then(resolve, reject);
    });

    itAsync('should stop polling when skip is true', (resolve, reject) => {
      let renderCount = 0;
      const Component = () => {
        const [shouldSkip, setShouldSkip] = useState(false);
        let { data, loading } = useQuery(CAR_QUERY, {
          pollInterval: 100,
          skip: shouldSkip
        });

        switch (++renderCount) {
          case 1:
            expect(loading).toBeTruthy();
            break;
          case 2:
            expect(loading).toBeFalsy();
            expect(data).toEqual(CAR_RESULT_DATA);
            setShouldSkip(true);
            break;
          case 3:
            expect(loading).toBeFalsy();
            expect(data).toBeUndefined();
            break;
          case 4:
            throw new Error('Uh oh - we should have stopped polling!');
          default:
            // Do nothing
        }

        return null;
      };

      render(
        <MockedProvider link={new MockLink(CAR_MOCKS).setOnError(reject)}>
          <Component />
        </MockedProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(3);
      }).then(resolve, reject);
    });

    itAsync('should stop polling when the component is unmounted', async (resolve, reject) => {
      const mocks = [
        ...CAR_MOCKS,
        ...CAR_MOCKS,
        ...CAR_MOCKS,
        ...CAR_MOCKS,
      ];

      const mockLink = new MockLink(mocks).setOnError(reject);

      const linkRequestSpy = jest.spyOn(mockLink, 'request');

      let renderCount = 0;
      const QueryComponent = ({ unmount }: { unmount: () => void }) => {
        const { data, loading } = useQuery(CAR_QUERY, { pollInterval: 10 });
        switch (++renderCount) {
          case 1:
            expect(loading).toBeTruthy();
            break;
          case 2:
            expect(loading).toBeFalsy();
            expect(data).toEqual(CAR_RESULT_DATA);
            expect(linkRequestSpy).toHaveBeenCalledTimes(1);
            unmount();
            break;
          default:
            reject("unreached");
        }
        return null;
      };

      const Component = () => {
        const [queryMounted, setQueryMounted] = useState(true);
        const unmount = () => setTimeout(() => setQueryMounted(false), 0);
        return <>{queryMounted && <QueryComponent unmount={unmount} />}</>;
      };

      render(
        <MockedProvider mocks={CAR_MOCKS} link={mockLink}>
          <Component />
        </MockedProvider>
      );

      return wait(() => {
        expect(linkRequestSpy).toHaveBeenCalledTimes(1);
      }).then(resolve, reject);
    });

    itAsync(
      'should not throw an error if `stopPolling` is called manually after ' +
        'a component has unmounted (even though polling has already been ' +
        'stopped automatically)',
      (resolve, reject) => {
        let unmount: any;
        let renderCount = 0;
        const Component = () => {
          const { data, loading, stopPolling } = useQuery(CAR_QUERY, {
            pollInterval: 10
          });
          switch (renderCount) {
            case 0:
              expect(loading).toBeTruthy();
              break;
            case 1:
              expect(loading).toBeFalsy();
              expect(data).toEqual(CAR_RESULT_DATA);
              setTimeout(() => {
                unmount();
                stopPolling();
              });
              break;
            default:
          }
          renderCount += 1;
          return null;
        };

        const mocks = [...CAR_MOCKS, ...CAR_MOCKS];

        unmount = render(
          <MockedProvider link={new MockLink(mocks).setOnError(reject)}>
            <Component />
          </MockedProvider>
        ).unmount;

        return wait(() => {
          expect(renderCount).toBe(2);
        }).then(resolve, reject);
      }
    );

    it('should set called to true by default', () => {
      const Component = () => {
        const { loading, called } = useQuery(CAR_QUERY);
        expect(loading).toBeTruthy();
        expect(called).toBeTruthy();
        return null;
      };

      render(
        <MockedProvider mocks={CAR_MOCKS}>
          <Component />
        </MockedProvider>
      );
    });
  });

  describe('Error handling', () => {
    itAsync("should render GraphQLError's", (resolve, reject) => {
      const query = gql`
        query TestQuery {
          rates(currency: "USD") {
            rate
          }
        }
      `;

      const mocks = [
        {
          request: { query },
          result: {
            errors: [new GraphQLError('forced error')]
          }
        }
      ];

      const Component = () => {
        const { loading, error } = useQuery(query);
        if (!loading) {
          expect(error).toBeDefined();
          expect(error!.message).toEqual('forced error');
        }
        return null;
      };

      render(
        <MockedProvider mocks={mocks}>
          <Component />
        </MockedProvider>
      );

      return wait().then(resolve, reject);
    });

    itAsync('should only call onError callbacks once', (resolve, reject) => {
      const query = gql`
        query SomeQuery {
          stuff {
            thing
          }
        }
      `;

      const resultData = { stuff: { thing: 'it!', __typename: 'Stuff' } };

      let callCount = 0;
      const link = new ApolloLink(() => {
        if (!callCount) {
          callCount += 1;
          return new Observable(observer => {
            observer.error(new Error('Oh no!'));
          });
        } else {
          return Observable.of({ data: resultData });
        }
      });

      const client = new ApolloClient({
        link,
        cache: new InMemoryCache()
      });

      let onError: QueryFunctionOptions['onError'];
      const onErrorPromise = new Promise(resolve => onError = resolve);

      let renderCount = 0;
      const Component = () => {
        const { loading, error, refetch, data, networkStatus } = useQuery(
          query,
          {
            onError,
            notifyOnNetworkStatusChange: true
          }
        );

        switch (++renderCount) {
          case 1:
            expect(loading).toBeTruthy();
            break;
          case 2:
            expect(loading).toBeFalsy();
            expect(error).toBeDefined();
            expect(error!.message).toEqual('Oh no!');
            onErrorPromise.then(() => refetch());
            break;
          case 3:
            expect(loading).toBeTruthy();
            expect(networkStatus).toBe(NetworkStatus.refetch);
            break;
          case 4:
            expect(loading).toBeFalsy();
            expect(data).toEqual(resultData);
            break;
          default: // Do nothing
        }

        return null;
      };

      render(
        <ApolloProvider client={client}>
          <Component />
        </ApolloProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(4);
      }).then(resolve, reject);
    });

    itAsync('should persist errors on re-render if they are still valid', (resolve, reject) => {
      const query = gql`
        query SomeQuery {
          stuff {
            thing
          }
        }
      `;

      const mocks = [
        {
          request: { query },
          result: {
            errors: [new GraphQLError('forced error')]
          }
        }
      ];

      let renderCount = 0;
      function App() {
        const [, forceUpdate] = useReducer(x => x + 1, 0);
        const { loading, error } = useQuery(query);

        switch (++renderCount) {
          case 1:
            expect(loading).toBeTruthy();
            expect(error).toBeUndefined();
            break;
          case 2:
            expect(error).toBeDefined();
            expect(error!.message).toEqual('forced error');
            setTimeout(() => {
              forceUpdate();
            });
            break;
          case 3:
            expect(error).toBeDefined();
            expect(error!.message).toEqual('forced error');
            break;
          default: // Do nothing
        }

        return null;
      }

      render(
        <MockedProvider mocks={mocks}>
          <App />
        </MockedProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(3);
      }).then(resolve, reject);
    });

    itAsync(
      'should persist errors on re-render when inlining onError and/or ' +
        'onCompleted callbacks',
      (resolve, reject) => {
        const query = gql`
          query SomeQuery {
            stuff {
              thing
            }
          }
        `;

        const mocks = [
          {
            request: { query },
            result: {
              errors: [new GraphQLError('forced error')]
            }
          }
        ];
        mocks.push(...mocks);
        mocks.push(...mocks);

        const link = new MockLink(mocks).setOnError(reject);

        let renderCount = 0;
        function App() {
          const [, forceUpdate] = useReducer(x => x + 1, 0);
          const { loading, error } = useQuery(query, {
            onError: () => {},
            onCompleted: () => {}
          });

          switch (++renderCount) {
            case 1:
              expect(loading).toBeTruthy();
              expect(error).toBeUndefined();
              break;
            case 2:
              expect(error).toBeDefined();
              expect(error!.message).toEqual('forced error');
              setTimeout(() => {
                forceUpdate();
              });
              break;
            case 3:
              expect(error).toBeDefined();
              expect(error!.message).toEqual('forced error');
              break;
            default: // Do nothing
          }

          return null;
        }

        render(
          <MockedProvider link={link}>
            <App />
          </MockedProvider>
        );

        return wait(() => {
          expect(renderCount).toBe(3);
        }).then(resolve, reject);
      }
    );

    itAsync('should render errors (different error messages) with loading done on refetch', (resolve, reject) => {
      const query = gql`
        query SomeQuery {
          stuff {
            thing
          }
        }
      `;

      const mocks = [
        {
          request: { query },
          result: {
            errors: [new GraphQLError('an error 1')]
          }
        },
        {
          request: { query },
          result: {
            errors: [new GraphQLError('an error 2')]
          }
        }
      ];

      let renderCount = 0;
      function App() {
        const { loading, error, refetch } = useQuery(query, {
          notifyOnNetworkStatusChange: true
        });

        switch (++renderCount) {
          case 1:
            expect(loading).toBeTruthy();
            expect(error).toBeUndefined();
            break;
          case 2:
            expect(loading).toBeFalsy();
            expect(error).toBeDefined();
            expect(error!.message).toEqual('an error 1');
            setTimeout(() => {
              // catch here to avoid failing due to 'uncaught promise rejection'
              refetch().catch(() => {});
            });
            break;
          case 3:
            expect(loading).toBeTruthy();
            expect(error).toBeUndefined();
            break;
          case 4:
            expect(loading).toBeFalsy();
            expect(error).toBeDefined();
            expect(error!.message).toEqual('an error 2');
            break;
          default: // Do nothing
        }

        return null;
      }

      render(
        <MockedProvider mocks={mocks}>
          <App />
        </MockedProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(4);
      }).then(resolve, reject);
    });

    itAsync('should not re-render same error message on refetch', (resolve, reject) => {
      const query = gql`
        query SomeQuery {
          stuff {
            thing
          }
        }
      `;

      const mocks = [
        {
          request: { query },
          result: {
            errors: [new GraphQLError('same error message')]
          }
        },
        {
          request: { query },
          result: {
            errors: [new GraphQLError('same error message')]
          }
        }
      ];

      let renderCount = 0;
      function App() {
        const { loading, error, refetch } = useQuery(query, {
          notifyOnNetworkStatusChange: true
        });

        switch (++renderCount) {
          case 1:
            expect(loading).toBeTruthy();
            expect(error).toBeUndefined();
            break;
          case 2:
            expect(loading).toBeFalsy();
            expect(error).toBeDefined();
            expect(error!.message).toEqual('same error message');
            refetch().catch(error => {
              if (error.message !== 'same error message') {
                reject(error);
              }
            });
            break;
          case 3:
            expect(loading).toBeTruthy();
            expect(error).toBeUndefined();
            break;
          case 4:
            expect(loading).toBeFalsy();
            expect(error).toBeDefined();
            expect(error!.message).toEqual('same error message');
            break;
          default: // Do nothing
        }

        return null;
      }

      render(
        <MockedProvider mocks={mocks}>
          <App />
        </MockedProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(4);
      }).then(resolve, reject);
    });

    itAsync('should render both success and errors (same error messages) with loading done on refetch', (resolve, reject) => {
      const mocks = [
        {
          request: { query: CAR_QUERY },
          result: {
            errors: [new GraphQLError('same error message')]
          }
        },
        {
          request: { query: CAR_QUERY },
          result: {
            data: CAR_RESULT_DATA
          }
        },
        {
          request: { query: CAR_QUERY },
          result: {
            errors: [new GraphQLError('same error message')]
          }
        }
      ];

      let renderCount = 0;
      function App() {
        const { loading, data, error, refetch } = useQuery(CAR_QUERY, {
          notifyOnNetworkStatusChange: true
        });

        switch (++renderCount) {
          case 1:
            expect(loading).toBeTruthy();
            expect(error).toBeUndefined();
            break;
          case 2:
            expect(loading).toBeFalsy();
            expect(error).toBeDefined();
            expect(error!.message).toEqual('same error message');
            setTimeout(() => {
              // catch here to avoid failing due to 'uncaught promise rejection'
              refetch().catch(() => {});
            });
            break;
          case 3:
            expect(loading).toBeTruthy();
            break;
          case 4:
            expect(loading).toBeFalsy();
            expect(error).toBeUndefined();
            expect(data).toEqual(CAR_RESULT_DATA);
            setTimeout(() => {
              // catch here to avoid failing due to 'uncaught promise rejection'
              refetch().catch(() => {});
            });
            break;
          case 5:
            expect(loading).toBeTruthy();
            break;
          case 6:
            expect(loading).toBeFalsy();
            expect(error).toBeDefined();
            expect(error!.message).toEqual('same error message');
            break;
          default: // Do nothing
        }

        return null;
      }

      render(
        <MockedProvider mocks={mocks}>
          <App />
        </MockedProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(6);
      }).then(resolve, reject);
    });
  });

  describe('Pagination', () => {
    itAsync(
      'should render `fetchMore.updateQuery` updated results with proper ' +
        'loading status, when `notifyOnNetworkStatusChange` is true',
      (resolve, reject) => {
        const carQuery: DocumentNode = gql`
          query cars($limit: Int) {
            cars(limit: $limit) {
              id
              make
              model
              vin
              __typename
            }
          }
        `;

        const carResults = {
          cars: [
            {
              id: 1,
              make: 'Audi',
              model: 'RS8',
              vin: 'DOLLADOLLABILL',
              __typename: 'Car'
            }
          ]
        };

        const moreCarResults = {
          cars: [
            {
              id: 2,
              make: 'Audi',
              model: 'eTron',
              vin: 'TREESRGOOD',
              __typename: 'Car'
            }
          ]
        };

        const mocks = [
          {
            request: { query: carQuery, variables: { limit: 1 } },
            result: { data: carResults }
          },
          {
            request: { query: carQuery, variables: { limit: 1 } },
            result: { data: moreCarResults }
          }
        ];

        let renderCount = 0;
        function App() {
          const { loading, data, fetchMore } = useQuery(carQuery, {
            variables: { limit: 1 },
            notifyOnNetworkStatusChange: true
          });

          switch (++renderCount) {
            case 1:
              expect(loading).toBeTruthy();
              break;
            case 2:
              expect(loading).toBeFalsy();
              expect(data).toEqual(carResults);
              fetchMore({
                variables: {
                  limit: 1
                },
                updateQuery: (prev, { fetchMoreResult }) => ({
                  cars: [
                    ...prev.cars,
                    ...fetchMoreResult.cars,
                  ],
                }),
              });
              break;
            case 3:
              expect(loading).toBeFalsy();
              expect(data).toEqual({
                cars: [
                  carResults.cars[0],
                  moreCarResults.cars[0],
                ],
              });
              break;
            default:
          }

          return null;
        }

        render(
          <MockedProvider mocks={mocks}>
            <App />
          </MockedProvider>
        );

        return wait(() => {
          expect(renderCount).toBe(3);
        }).then(resolve, reject);
      }
    );

    itAsync(
      'should render `fetchMore.updateQuery` updated results with no ' +
        'loading status, when `notifyOnNetworkStatusChange` is false',
      (resolve, reject) => {
        const carQuery: DocumentNode = gql`
          query cars($limit: Int) {
            cars(limit: $limit) {
              id
              make
              model
              vin
              __typename
            }
          }
        `;

        const carResults = {
          cars: [
            {
              id: 1,
              make: 'Audi',
              model: 'RS8',
              vin: 'DOLLADOLLABILL',
              __typename: 'Car'
            }
          ]
        };

        const moreCarResults = {
          cars: [
            {
              id: 2,
              make: 'Audi',
              model: 'eTron',
              vin: 'TREESRGOOD',
              __typename: 'Car'
            }
          ]
        };

        const mocks = [
          {
            request: { query: carQuery, variables: { limit: 1 } },
            result: { data: carResults }
          },
          {
            request: { query: carQuery, variables: { limit: 1 } },
            result: { data: moreCarResults }
          }
        ];

        let renderCount = 0;
        function App() {
          const { loading, data, fetchMore } = useQuery(carQuery, {
            variables: { limit: 1 },
            notifyOnNetworkStatusChange: false
          });

          switch (renderCount) {
            case 0:
              expect(loading).toBeTruthy();
              break;
            case 1:
              expect(loading).toBeFalsy();
              expect(data).toEqual(carResults);
              fetchMore({
                variables: {
                  limit: 1
                },
                updateQuery: (prev, { fetchMoreResult }) => ({
                  cars: [...prev.cars, ...fetchMoreResult.cars]
                })
              });
              break;
            case 2:
              expect(loading).toBeFalsy();
              expect(data).toEqual({
                cars: [carResults.cars[0], moreCarResults.cars[0]]
              });
              break;
            default:
          }

          renderCount += 1;
          return null;
        }

        render(
          <MockedProvider mocks={mocks}>
            <App />
          </MockedProvider>
        );

        return wait(() => {
          expect(renderCount).toBe(3);
        }).then(resolve, reject);
      }
    );
  });

  describe('Refetching', () => {
    itAsync('should properly handle refetching with different variables', (resolve, reject) => {
      const carQuery: DocumentNode = gql`
        query cars($id: Int) {
          cars(id: $id) {
            id
            make
            model
            vin
            __typename
          }
        }
      `;

      const carData1 = {
        cars: [
          {
            id: 1,
            make: 'Audi',
            model: 'RS8',
            vin: 'DOLLADOLLABILL',
            __typename: 'Car'
          }
        ]
      };

      const carData2 = {
        cars: [
          {
            id: 2,
            make: 'Audi',
            model: 'eTron',
            vin: 'TREESRGOOD',
            __typename: 'Car'
          }
        ]
      };

      const mocks = [
        {
          request: { query: carQuery, variables: { id: 1 } },
          result: { data: carData1 }
        },
        {
          request: { query: carQuery, variables: { id: 2 } },
          result: { data: carData2 }
        },
        {
          request: { query: carQuery, variables: { id: 1 } },
          result: { data: carData1 }
        }
      ];

      let renderCount = 0;
      function App() {
        const { loading, data, refetch } = useQuery(carQuery, {
          variables: { id: 1 },
          notifyOnNetworkStatusChange: true,
        });

        switch (renderCount) {
          case 0:
            expect(loading).toBeTruthy();
            break;
          case 1:
            expect(loading).toBeFalsy();
            expect(data).toEqual(carData1);
            refetch({ id: 2 });
            break;
          case 2:
            expect(loading).toBeTruthy();
            break;
          case 3:
            expect(loading).toBeFalsy();
            expect(data).toEqual(carData2);
            refetch({ id: 1 });
            break;
          case 4:
            expect(loading).toBeTruthy();
            break;
          case 5:
            expect(loading).toBeFalsy();
            expect(data).toEqual(carData1);
            break;
          default:
        }

        renderCount += 1;
        return null;
      }

      render(
        <MockedProvider mocks={mocks}>
          <App />
        </MockedProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(6);
      }).then(resolve, reject);
    });
  });

  describe('Partial refetching', () => {
    itAsync(
      'should attempt a refetch when the query result was marked as being ' +
        'partial, the returned data was reset to an empty Object by the ' +
        'Apollo Client QueryManager (due to a cache miss), and the ' +
        '`partialRefetch` prop is `true`',
      (resolve, reject) => {
        const query: DocumentNode = gql`
          query AllPeople($name: String!) {
            allPeople(name: $name) {
              people {
                name
              }
            }
          }
        `;

        interface Data {
          allPeople: {
            people: Array<{ name: string }>;
          };
        }

        const peopleData: Data = {
          allPeople: { people: [{ name: 'Luke Skywalker' }] }
        };

        const link = mockSingleLink(
          {
            request: {
              query,
              variables: {
                someVar: 'abc123'
              }
            },
            result: {
              data: undefined
            }
          },
          {
            request: {
              query,
              variables: {
                someVar: 'abc123'
              }
            },
            result: {
              data: peopleData
            }
          }
        );

        const client = new ApolloClient({
          link,
          cache: new InMemoryCache()
        });

        let renderCount = 0;
        const Component = () => {
          const { loading, data, networkStatus } = useQuery(query, {
            variables: { someVar: 'abc123' },
            partialRefetch: true,
            notifyOnNetworkStatusChange: true,
          });

          switch (++renderCount) {
            case 1:
              // Initial loading render
              expect(loading).toBeTruthy();
              expect(data).toBeUndefined();
              expect(networkStatus).toBe(NetworkStatus.loading);
              break;
            case 2:
              // `data` is missing and `partialRetch` is true, so a refetch
              // is triggered and loading is set as true again
              expect(loading).toBeTruthy();
              expect(data).toBeUndefined();
              expect(networkStatus).toBe(NetworkStatus.loading);
              break;
            case 3:
              expect(loading).toBeTruthy();
              expect(data).toBeUndefined();
              expect(networkStatus).toBe(NetworkStatus.refetch);
              break;
            case 4:
              // Refetch has completed
              expect(loading).toBeFalsy();
              expect(data).toEqual(peopleData);
              expect(networkStatus).toBe(NetworkStatus.ready);
              break;
            default:
          }

          return null;
        };

        render(
          <ApolloProvider client={client}>
            <Component />
          </ApolloProvider>
        );

        return wait(() => {
          expect(renderCount).toBe(4);
        }).then(resolve, reject);
      }
    );
  });

  describe('Callbacks', () => {
    itAsync(
      'should pass loaded data to onCompleted when using the cache-only ' +
        'fetch policy',
      (resolve, reject) => {
        const cache = new InMemoryCache();
        const client = new ApolloClient({
          cache,
          resolvers: {}
        });

        cache.writeQuery({
          query: CAR_QUERY,
          data: CAR_RESULT_DATA
        });

        let onCompletedCalled = false;
        const Component = () => {
          const { loading, data } = useQuery(CAR_QUERY, {
            fetchPolicy: 'cache-only',
            onCompleted(data) {
              onCompletedCalled = true;
              expect(data).toBeDefined();
            }
          });
          if (!loading) {
            expect(data).toEqual(CAR_RESULT_DATA);
          }
          return null;
        };

        render(
          <ApolloProvider client={client}>
            <Component />
          </ApolloProvider>
        );

        return wait(() => {
          expect(onCompletedCalled).toBeTruthy();
        }).then(resolve, reject);
      }
    );

    itAsync('should only call onCompleted once per query run', (resolve, reject) => {
      const cache = new InMemoryCache();
      const client = new ApolloClient({
        cache,
        resolvers: {}
      });

      cache.writeQuery({
        query: CAR_QUERY,
        data: CAR_RESULT_DATA
      });

      let onCompletedCount = 0;
      const Component = () => {
        const { loading, data } = useQuery(CAR_QUERY, {
          fetchPolicy: 'cache-only',
          onCompleted() {
            onCompletedCount += 1;
          }
        });
        if (!loading) {
          expect(data).toEqual(CAR_RESULT_DATA);
        }
        return null;
      };

      render(
        <ApolloProvider client={client}>
          <Component />
        </ApolloProvider>
      );

      return wait(() => {
        expect(onCompletedCount).toBe(1);
      }).then(resolve, reject);
    });
  });
});
