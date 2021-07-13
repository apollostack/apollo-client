import React, { useState, useReducer, Fragment, useEffect } from 'react';
import { DocumentNode, GraphQLError } from 'graphql';
import gql from 'graphql-tag';
import { render, cleanup, wait, act } from '@testing-library/react';

import { ApolloClient, NetworkStatus, TypedDocumentNode, WatchQueryFetchPolicy } from '../../../core';
import { InMemoryCache } from '../../../cache';
import { ApolloProvider } from '../../context';
import { Observable, Reference, concatPagination } from '../../../utilities';
import { ApolloLink } from '../../../link/core';
import { itAsync, MockLink, MockedProvider, mockSingleLink, withErrorSpy } from '../../../testing';
import { useQuery } from '../useQuery';
import { useMutation } from '../useMutation';
import { QueryFunctionOptions } from '../..';

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

    itAsync('should update with proper loading state when variables change for cached queries', (resolve, reject) => {
      const peopleQuery = gql`
        query AllPeople($search: String!) {
          people(search: $search) {
            id
            name
          }
        }
      `;

      const peopleData = {
        people: [
          { id: 1, name: "John Smith" },
          { id: 2, name: "Sara Smith" },
          { id: 3, name: "Budd Deey" }
        ]
      };

      const mocks = [
        {
          request: { query: peopleQuery, variables: { search: '' } },
          result: { data: peopleData },
        },
        {
          request: { query: peopleQuery, variables: { search: 'z' } },
          result: { data: { people: [] } },
        },
        {
          request: { query: peopleQuery, variables: { search: 'zz' } },
          result: { data: { people: [] } },
        },
      ];

      let renderCount = 0;
      const Component = () => {
        const [search, setSearch] = useState('');
        const { loading, data } = useQuery(peopleQuery, {
          variables: {
            search: search
          }
        });
        switch (++renderCount) {
          case 1:
            expect(loading).toBeTruthy();
            break;
          case 2:
            expect(loading).toBeFalsy();
            expect(data).toEqual(peopleData);
            setTimeout(() => setSearch('z'));
            break;
          case 3:
            expect(loading).toBeTruthy();
            break;
          case 4:
            expect(loading).toBeFalsy();
            expect(data).toEqual({ people: [] });
            setTimeout(() => setSearch(''));
            break;
          case 5:
            expect(loading).toBeFalsy();
            expect(data).toEqual(peopleData);
            setTimeout(() => setSearch('z'));
            break;
          case 6:
            expect(loading).toBeFalsy();
            expect(data).toEqual({ people: [] });
            setTimeout(() => setSearch('zz'));
            break;
          case 7:
            expect(loading).toBeTruthy();
            break;
          case 8:
            expect(loading).toBeFalsy();
            expect(data).toEqual({ people: [] });
            break;
          default:
        }
        return null;
      }

      render(
        <MockedProvider mocks={mocks}>
          <Component />
        </MockedProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(8);
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

    itAsync('should start polling when skip goes from true to false', (resolve, reject) => {
      const query = gql`
        query car {
          car {
            id
            make
          }
        }
      `;

      const data1 = {
        car: {
          id: 1,
          make: 'Venturi',
          __typename: 'Car',
        }
      };

      const data2 = {
        car: {
          id: 2,
          make: 'Wiesmann',
          __typename: 'Car',
        }
      };

      const mocks = [
        { request: { query }, result: { data: data1 } },
        { request: { query }, result: { data: data2 } }
      ];

      let renderCount = 0;
      const Component = () => {
        const [shouldSkip, setShouldSkip] = useState(false);
        let { data, loading, stopPolling } = useQuery(query, {
          pollInterval: 100,
          skip: shouldSkip,
        });

        switch (++renderCount) {
          case 1:
            expect(loading).toBeTruthy();
            expect(data).toBeUndefined();
            break;
          case 2:
            expect(loading).toBeFalsy();
            expect(data).toEqual(data1);
            setShouldSkip(true);
            break;
          case 3:
            expect(loading).toBeFalsy();
            expect(data).toBeUndefined();
            setShouldSkip(false);
            break;
          case 4:
            expect(loading).toBeFalsy();
            expect(data).toEqual(data1);
            break;
          case 5:
            expect(loading).toBeFalsy();
            expect(data).toEqual(data2);
            stopPolling();
            break;
          default:
            reject(new Error('too many updates'));
        }

        return null;
      };

      render(
        <MockedProvider link={new MockLink(mocks).setOnError(reject)}>
          <Component />
        </MockedProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(5);
      }).then(resolve, reject);
    });

    function useStatefulUnmount() {
      const [queryMounted, setQueryMounted] = useState(true);

      let mounted = false;
      useEffect(() => {
        mounted = true;
        expect(queryMounted).toBe(true);
        return () => {
          mounted = false;
        };
      }, []);

      return {
        mounted: queryMounted,
        unmount() {
          if (mounted) {
            setQueryMounted(mounted = false);
          }
        },
      };
    }

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
            setTimeout(unmount, 10);
            break;
          default:
            reject("unreached");
        }
        return null;
      };

      const Component = () => {
        const { mounted, unmount } = useStatefulUnmount();
        return <>{mounted && <QueryComponent unmount={unmount} />}</>;
      };

      render(
        <MockedProvider mocks={CAR_MOCKS} link={mockLink}>
          <Component />
        </MockedProvider>
      );

      return wait(() => {
        expect(linkRequestSpy).toHaveBeenCalledTimes(1);
        expect(renderCount).toBe(2);
      }).then(resolve, reject);
    });

    itAsync('should stop polling when the component is unmounted when using StrictMode', async (resolve, reject) => {
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
          case 2:
            expect(loading).toBeTruthy();
            break;
          case 3:
          case 4:
            expect(loading).toBeFalsy();
            expect(data).toEqual(CAR_RESULT_DATA);
            expect(linkRequestSpy).toHaveBeenCalledTimes(1);
            if (renderCount === 3) {
              setTimeout(unmount, 10);
            }
            break;
          default:
            reject("unreached");
        }
        return null;
      };

      const Component = () => {
        const { mounted, unmount } = useStatefulUnmount();
        return <>{mounted && <QueryComponent unmount={unmount} />}</>;
      };

      render(
        <React.StrictMode>
          <MockedProvider mocks={CAR_MOCKS} link={mockLink}>
            <Component />
          </MockedProvider>
        </React.StrictMode>
      );

      return wait(() => {
        expect(linkRequestSpy).toHaveBeenCalledTimes(1);
        expect(renderCount).toBe(4);
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

    itAsync(
      'stop polling and start polling should work with StrictMode',
      (resolve, reject) => {
        const query = gql`
          query car {
            car {
              id
              make
            }
          }
        `;

        const data1 = {
          car: {
            id: 1,
            make: 'Venturi',
            __typename: 'Car',
          }
        };

        const mocks = [
          { request: { query }, result: { data: data1 } },
        ];

        let renderCount = 0;
        const Component = () => {
          let { data, loading, stopPolling } = useQuery(query, {
            pollInterval: 100,
          });

          switch (++renderCount) {
            case 1:
            case 2:
              expect(loading).toBeTruthy();
              expect(data).toBeUndefined();
              break;
            case 3:
            case 4:
              expect(loading).toBeFalsy();
              expect(data).toEqual(data1);
              stopPolling();
              break;
            default:
              reject(new Error('Unexpected render count'));
          }

          return null;
        };

        render(
          <React.StrictMode>
            <MockedProvider link={new MockLink(mocks).setOnError(reject)}>
              <Component />
            </MockedProvider>
          </React.StrictMode>
        );

        return wait(() => {
          expect(renderCount).toBe(4);
        }).then(() => setTimeout(resolve, 300), reject);
      },
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
    // Because fetchMore with updateQuery is deprecated, this setup/teardown
    // code is used to squash deprecation notices.
    // TODO: delete me after fetchMore with updateQuery is removed.
    let spy: any;
    let warned = false;
    beforeEach(() => {
      if (!warned) {
        spy = jest.spyOn(console, "warn").mockImplementation(() => {
          warned = true;
        });
      }
    });

    afterEach(() => {
      if (spy) {
        spy.mockRestore();
        spy = undefined;
      }
    });

    describe('should render fetchMore-updated results with proper loading status, when `notifyOnNetworkStatusChange` is true', () => {
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

      itAsync('updateQuery', (resolve, reject) => {
        let renderCount = 0;
        function App() {
          const { loading, networkStatus, data, fetchMore } = useQuery(carQuery, {
            variables: { limit: 1 },
            notifyOnNetworkStatusChange: true
          });

          switch (++renderCount) {
            case 1:
              expect(loading).toBeTruthy();
              expect(networkStatus).toBe(NetworkStatus.loading);
              expect(data).toBeUndefined();
              break;
            case 2:
              expect(loading).toBeFalsy();
              expect(networkStatus).toBe(NetworkStatus.ready);
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
              expect(loading).toBeTruthy();
              expect(networkStatus).toBe(NetworkStatus.fetchMore);
              expect(data).toEqual(carResults);
              break;
            case 4:
              expect(loading).toBeFalsy();
              expect(networkStatus).toBe(NetworkStatus.ready);
              expect(data).toEqual({
                cars: [
                  carResults.cars[0],
                  moreCarResults.cars[0],
                ],
              });
              break;
            default:
              reject("too many updates");
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
          // TODO: delete me after fetchMore with updateQuery is removed.
          if (spy) {
            expect(spy).toHaveBeenCalledTimes(1);
            spy.mockRestore();
          }
        }).then(resolve, reject);
      });

      itAsync('field policy', (resolve, reject) => {
        let renderCount = 0;
        function App() {
          const { loading, networkStatus, data, fetchMore } = useQuery(carQuery, {
            variables: { limit: 1 },
            notifyOnNetworkStatusChange: true
          });

          switch (++renderCount) {
            case 1:
              expect(loading).toBeTruthy();
              expect(networkStatus).toBe(NetworkStatus.loading);
              expect(data).toBeUndefined();
              break;
            case 2:
              expect(loading).toBeFalsy();
              expect(networkStatus).toBe(NetworkStatus.ready);
              expect(data).toEqual(carResults);
              fetchMore({
                variables: {
                  limit: 1
                },
              });
              break;
            case 3:
              expect(loading).toBeTruthy();
              expect(networkStatus).toBe(NetworkStatus.fetchMore);
              expect(data).toEqual(carResults);
              break;
            case 4:
              expect(loading).toBeFalsy();
              expect(networkStatus).toBe(NetworkStatus.ready);
              expect(data).toEqual({
                cars: [
                  carResults.cars[0],
                  moreCarResults.cars[0],
                ],
              });
              break;
            default:
              reject("too many updates");
          }

          return null;
        }

        const cache = new InMemoryCache({
          typePolicies: {
            Query: {
              fields: {
                cars: concatPagination(),
              },
            },
          },
        });

        render(
          <MockedProvider mocks={mocks} cache={cache}>
            <App />
          </MockedProvider>
        );

        return wait(() => {
          expect(renderCount).toBe(4);
          // TODO: delete me after fetchMore with updateQuery is removed.
          if (spy) {
            expect(spy).toHaveBeenCalledTimes(1);
            spy.mockRestore();
          }
        }).then(resolve, reject);
      });
    });

    describe('should render fetchMore-updated results with no loading status, when `notifyOnNetworkStatusChange` is false', () => {
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

      itAsync('updateQuery', (resolve, reject) => {
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
      });

      itAsync('field policy', (resolve, reject) => {
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

        const cache = new InMemoryCache({
          typePolicies: {
            Query: {
              fields: {
                cars: concatPagination(),
              },
            },
          },
        });

        render(
          <MockedProvider mocks={mocks} cache={cache}>
            <App />
          </MockedProvider>
        );

        return wait(() => {
          expect(renderCount).toBe(3);
        }).then(resolve, reject);
      });
    });
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

  describe('options.refetchWritePolicy', () => {
    const query = gql`
      query GetPrimes ($min: number, $max: number) {
        primes(min: $min, max: $max)
      }
    `;

    const mocks = [
      {
        request: {
          query,
          variables: { min: 0, max: 12 },
        },
        result: {
          data: {
            primes: [2, 3, 5, 7, 11],
          }
        }
      },
      {
        request: {
          query,
          variables: { min: 12, max: 30 },
        },
        result: {
          data: {
            primes: [13, 17, 19, 23, 29],
          }
        }
      },
    ];

    itAsync('should support explicit "overwrite"', (resolve, reject) => {
      const mergeParams: [any, any][] = [];
      const cache = new InMemoryCache({
        typePolicies: {
          Query: {
            fields: {
              primes: {
                keyArgs: false,
                merge(existing, incoming) {
                  mergeParams.push([existing, incoming]);
                  return existing ? [
                    ...existing,
                    ...incoming,
                  ] : incoming;
                },
              },
            },
          },
        },
      });

      let renderCount = 0;

      function App() {
        const {
          loading,
          networkStatus,
          data,
          error,
          refetch,
        } = useQuery(query, {
          variables: { min: 0, max: 12 },
          notifyOnNetworkStatusChange: true,
          // This is the key line in this test.
          refetchWritePolicy: "overwrite",
        });

        switch (++renderCount) {
          case 1:
            expect(loading).toBeTruthy();
            expect(error).toBeUndefined();
            expect(data).toBeUndefined();
            expect(typeof refetch).toBe('function');
            break;
          case 2:
            expect(loading).toBe(false);
            expect(error).toBeUndefined();
            expect(data).toEqual({
              primes: [2, 3, 5, 7, 11],
            });
            expect(mergeParams).toEqual([
              [void 0, [2, 3, 5, 7, 11]],
            ]);
            act(() => {
              refetch({
                min: 12,
                max: 30,
              }).then(result => {
                expect(result).toEqual({
                  loading: false,
                  networkStatus: NetworkStatus.ready,
                  data: {
                    primes: [13, 17, 19, 23, 29],
                  },
                });
              });
            });
            break;
          case 3:
            expect(loading).toBe(true);
            expect(error).toBeUndefined();
            expect(data).toEqual({
              // We get the stale data because we configured keyArgs: false.
              primes: [2, 3, 5, 7, 11],
            });
            // This networkStatus is setVariables instead of refetch because
            // we called refetch with new variables.
            expect(networkStatus).toBe(NetworkStatus.setVariables);
            break;
          case 4:
            expect(loading).toBe(false);
            expect(error).toBeUndefined();
            expect(data).toEqual({
              primes: [13, 17, 19, 23, 29],
            });
            expect(mergeParams).toEqual([
              [void 0, [2, 3, 5, 7, 11]],
              // Without refetchWritePolicy: "overwrite", this array will be
              // all 10 primes (2 through 29) together.
              [void 0, [13, 17, 19, 23, 29]],
            ]);
            break;
          default:
            reject("too many renders");
        }

        return null;
      }

      render(
        <MockedProvider cache={cache} mocks={mocks}>
          <App />
        </MockedProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(4);
      }).then(resolve, reject);
    });

    itAsync('should support explicit "merge"', (resolve, reject) => {
      const mergeParams: [any, any][] = [];
      const cache = new InMemoryCache({
        typePolicies: {
          Query: {
            fields: {
              primes: {
                keyArgs: false,
                merge(existing, incoming) {
                  mergeParams.push([existing, incoming]);
                  return existing ? [
                    ...existing,
                    ...incoming,
                  ] : incoming;
                },
              },
            },
          },
        },
      });

      let renderCount = 0;

      function App() {
        const {
          loading,
          networkStatus,
          data,
          error,
          refetch,
        } = useQuery(query, {
          variables: { min: 0, max: 12 },
          notifyOnNetworkStatusChange: true,
          // This is the key line in this test.
          refetchWritePolicy: "merge",
        });

        switch (++renderCount) {
          case 1:
            expect(loading).toBeTruthy();
            expect(error).toBeUndefined();
            expect(data).toBeUndefined();
            expect(typeof refetch).toBe('function');
            break;
          case 2:
            expect(loading).toBe(false);
            expect(error).toBeUndefined();
            expect(data).toEqual({
              primes: [2, 3, 5, 7, 11],
            });
            expect(mergeParams).toEqual([
              [void 0, [2, 3, 5, 7, 11]],
            ]);
            act(() => {
              refetch({
                min: 12,
                max: 30,
              }).then(result => {
                expect(result).toEqual({
                  loading: false,
                  networkStatus: NetworkStatus.ready,
                  data: {
                    primes: [2, 3, 5, 7, 11, 13, 17, 19, 23, 29],
                  },
                });
              });
            });
            break;
          case 3:
            expect(loading).toBe(true);
            expect(error).toBeUndefined();
            expect(data).toEqual({
              // We get the stale data because we configured keyArgs: false.
              primes: [2, 3, 5, 7, 11],
            });
            // This networkStatus is setVariables instead of refetch because
            // we called refetch with new variables.
            expect(networkStatus).toBe(NetworkStatus.setVariables);
            break;
          case 4:
            expect(loading).toBe(false);
            expect(error).toBeUndefined();
            expect(data).toEqual({
              // Thanks to refetchWritePolicy: "merge".
              primes: [2, 3, 5, 7, 11, 13, 17, 19, 23, 29],
            });
            expect(mergeParams).toEqual([
              [void 0, [2, 3, 5, 7, 11]],
              // This indicates concatenation happened.
              [[2, 3, 5, 7, 11], [13, 17, 19, 23, 29]],
            ]);
            break;
          default:
            reject("too many renders");
        }

        return null;
      }

      render(
        <MockedProvider cache={cache} mocks={mocks}>
          <App />
        </MockedProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(4);
      }).then(resolve, reject);
    });

    itAsync('should assume default refetchWritePolicy value is "overwrite"', (resolve, reject) => {
      const mergeParams: [any, any][] = [];
      const cache = new InMemoryCache({
        typePolicies: {
          Query: {
            fields: {
              primes: {
                keyArgs: false,
                merge(existing, incoming) {
                  mergeParams.push([existing, incoming]);
                  return existing ? [
                    ...existing,
                    ...incoming,
                  ] : incoming;
                },
              },
            },
          },
        },
      });

      let renderCount = 0;

      function App() {
        const {
          loading,
          networkStatus,
          data,
          error,
          refetch,
        } = useQuery(query, {
          variables: { min: 0, max: 12 },
          notifyOnNetworkStatusChange: true,
          // Intentionally not passing refetchWritePolicy.
        });

        switch (++renderCount) {
          case 1:
            expect(loading).toBeTruthy();
            expect(error).toBeUndefined();
            expect(data).toBeUndefined();
            expect(typeof refetch).toBe('function');
            break;
          case 2:
            expect(loading).toBe(false);
            expect(error).toBeUndefined();
            expect(data).toEqual({
              primes: [2, 3, 5, 7, 11],
            });
            expect(mergeParams).toEqual([
              [void 0, [2, 3, 5, 7, 11]],
            ]);
            act(() => {
              refetch({
                min: 12,
                max: 30,
              }).then(result => {
                expect(result).toEqual({
                  loading: false,
                  networkStatus: NetworkStatus.ready,
                  data: {
                    primes: [13, 17, 19, 23, 29],
                  },
                });
              });
            });
            break;
          case 3:
            expect(loading).toBe(true);
            expect(error).toBeUndefined();
            expect(data).toEqual({
              // We get the stale data because we configured keyArgs: false.
              primes: [2, 3, 5, 7, 11],
            });
            // This networkStatus is setVariables instead of refetch because
            // we called refetch with new variables.
            expect(networkStatus).toBe(NetworkStatus.setVariables);
            break;
          case 4:
            expect(loading).toBe(false);
            expect(error).toBeUndefined();
            expect(data).toEqual({
              primes: [13, 17, 19, 23, 29],
            });
            expect(mergeParams).toEqual([
              [void 0, [2, 3, 5, 7, 11]],
              // Without refetchWritePolicy: "overwrite", this array will be
              // all 10 primes (2 through 29) together.
              [void 0, [13, 17, 19, 23, 29]],
            ]);
            break;
          default:
            reject("too many renders");
        }

        return null;
      }

      render(
        <MockedProvider cache={cache} mocks={mocks}>
          <App />
        </MockedProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(4);
      }).then(resolve, reject);
    });
  });

  describe('Partial refetching', () => {
    withErrorSpy(itAsync,
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

    itAsync('should not repeatedly call onCompleted if it alters state', (resolve, reject) => {
      const query = gql`
        query people($first: Int) {
          allPeople(first: $first) {
            people {
              name
            }
          }
        }
      `;

      const data1 = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };
      const mocks = [
        {
          request: { query, variables: { first: 1 } },
          result: { data: data1 },
        },
      ];

      let renderCount = 0;
      function Component() {
        const [onCompletedCallCount, setOnCompletedCallCount] = useState(0);
        const { loading, data } = useQuery(query, {
          variables: { first: 1 },
          onCompleted() {
            setOnCompletedCallCount(onCompletedCallCount + 1);
          }
        });
        switch (renderCount) {
          case 0:
            expect(loading).toBeTruthy();
            break;
          case 1:
            expect(loading).toBeFalsy();
            expect(data).toEqual(data1);
            break;
          case 2:
            expect(loading).toBeFalsy();
            expect(onCompletedCallCount).toBe(1);
            break;
          default:
        }
        renderCount += 1;
        return null;
      }

      render(
        <MockedProvider mocks={mocks} addTypename={false}>
          <Component />
        </MockedProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(3);
      }).then(resolve, reject);
    });

    itAsync('should not call onCompleted if skip is true', (resolve, reject) => {
      function Component() {
        const { loading } = useQuery(CAR_QUERY, {
          skip: true,
          onCompleted() {
            fail('should not call onCompleted!');
          }
        });
        expect(loading).toBeFalsy();
        return null;
      }

      render(
        <MockedProvider mocks={CAR_MOCKS}>
          <Component />
        </MockedProvider>
      );

      return wait().then(resolve, reject);
    });

    itAsync(
      'should not make extra network requests when `onCompleted` is ' +
      'defined with a `network-only` fetch policy',
      (resolve, reject) => {
        let renderCount = 0;
        function Component() {
          const { loading, data } = useQuery(CAR_QUERY, {
            fetchPolicy: 'network-only',
            onCompleted: () => undefined
          });
          switch (++renderCount) {
            case 1:
              expect(loading).toBeTruthy();
              break;
            case 2:
              expect(loading).toBeFalsy();
              expect(data).toEqual(CAR_RESULT_DATA);
              break;
            case 3:
              fail('Too many renders');
            default:
          }
          return null;
        }

        render(
          <MockedProvider mocks={CAR_MOCKS}>
            <Component />
          </MockedProvider>
        );

        return wait(() => {
          expect(renderCount).toBe(2);
        }).then(resolve, reject);
      }
    );
  });

  describe('Optimistic data', () => {
    itAsync('should display rolled back optimistic data when an error occurs', (resolve, reject) => {
      const query = gql`
        query AllCars {
          cars {
            id
            make
            model
          }
        }
      `;

      const carsData = {
        cars: [
          {
            id: 1,
            make: 'Audi',
            model: 'RS8',
            __typename: 'Car'
          }
        ]
      };

      const mutation = gql`
        mutation AddCar {
          addCar {
            id
            make
            model
          }
        }
      `;

      const carData = {
        id: 2,
        make: 'Ford',
        model: 'Pinto',
        __typename: 'Car'
      };

      const allCarsData = {
        cars: [
          carsData.cars[0],
          carData
        ]
      };

      const mocks = [
        {
          request: {
            query
          },
          result: { data: carsData }
        },
        {
          request: {
            query: mutation
          },
          error: new Error('Oh no!')
        }
      ];

      let renderCount = 0;
      const Component = () => {
        const [mutate, { loading: mutationLoading }] = useMutation(mutation, {
          optimisticResponse: {
            addCar: carData,
          },
          update: (cache, { data }) => {
            cache.modify({
              fields: {
                cars(existing, { readField }) {
                  const newCarRef = cache.writeFragment({
                    data: data!.addCar,
                    fragment: gql`fragment NewCar on Car {
                      id
                      make
                      model
                    }`,
                  });
                  if (existing.some(
                    (ref: Reference) => readField('id', ref) === data!.addCar.id
                  )) {
                    return existing;
                  }
                  return [...existing, newCarRef];
                }
              }
            });
          },
          onError() {
            // Swallow error
          }
        });

        const { data, loading: queryLoading } = useQuery(query);
        switch(++renderCount) {
          case 1:
            // The query ran and is loading the result.
            expect(queryLoading).toBeTruthy();
            break;
          case 2:
            // The query has completed.
            expect(queryLoading).toBeFalsy();
            expect(data).toEqual(carsData);
            // Trigger a mutation (with optimisticResponse data).
            mutate();
            break;
          case 3:
            // The mutation ran and is loading the result. The query stays at
            // not loading as nothing has changed for the query.
            expect(mutationLoading).toBeTruthy();
            expect(queryLoading).toBeFalsy();
            break;
          case 4:
            // The first part of the mutation has completed using the defined
            // optimisticResponse data. This means that while the mutation
            // stays in a loading state, it has made its optimistic data
            // available to the query. New optimistic data doesn't trigger a
            // query loading state.
            expect(mutationLoading).toBeTruthy();
            expect(queryLoading).toBeFalsy();
            expect(data).toEqual(allCarsData);
            break;
          case 5:
            // The mutation wasn't able to fulfill its network request so it
            // errors, which means the initially returned optimistic data is
            // rolled back, and the query no longer has access to it.
            expect(mutationLoading).toBeTruthy();
            expect(queryLoading).toBeFalsy();
            expect(data).toEqual(carsData);
            break;
          case 6:
            // The mutation has completely finished, leaving the query
            // with access to the original cache data.
            expect(mutationLoading).toBeFalsy();
            expect(queryLoading).toBeFalsy();
            expect(data).toEqual(carsData);
            break;
          default:
        }
        return null;
      };

      render(
        <MockedProvider mocks={mocks}>
          <Component />
        </MockedProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(6);
      }).then(resolve, reject);
    });
  });

  describe('Client Resolvers', () => {

    itAsync("should receive up to date @client(always: true) fields on entity update", (resolve, reject) => {
      const query = gql`
        query GetClientData($id: ID) {
          clientEntity(id: $id) @client(always: true) {
            id
            title
            titleLength @client(always: true)
          }
        }
      `;

      const mutation = gql`
        mutation AddOrUpdate {
          addOrUpdate(id: $id, title: $title) @client
        }
      `;

      const fragment = gql`
      fragment ClientDataFragment on ClientData {
        id
        title
      }
      `
      const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(() => Observable.of({ data: { } })),
        resolvers: {
          ClientData: {
            titleLength(data) {
              return data.title.length
            }
          },
          Query: {
            clientEntity(_root, {id}, {cache}) {
              return cache.readFragment({
                id: cache.identify({id, __typename: "ClientData"}),
                fragment,
              });
            },
          },
          Mutation: {
            addOrUpdate(_root, {id, title}, {cache}) {
              return cache.writeFragment({
                id: cache.identify({id, __typename: "ClientData"}),
                fragment,
                data: {id, title, __typename: "ClientData"},
              });
            },
          }
        },
      });

      const entityId = 1;
      const shortTitle = "Short";
      const longerTitle = "A little longer";
      client.mutate({
        mutation,
        variables: {
          id: entityId,
          title: shortTitle,
        },
      });
      let renderCount = 0;
      function App() {
        const { data } = useQuery(query, {
          variables: {
            id: entityId,
          }
        });

        switch (++renderCount) {
          case 2:
            expect(data.clientEntity).toEqual({
              id: entityId,
              title: shortTitle,
              titleLength: shortTitle.length,
              __typename: "ClientData",
            });
            setTimeout(() => {
              client.mutate({
                mutation,
                variables: {
                  id: entityId,
                  title: longerTitle,
                }
              });
            });
            break;
          case 3:
            expect(data.clientEntity).toEqual({
              id: entityId,
              title: longerTitle,
              titleLength: longerTitle.length,
              __typename: "ClientData",
            });
            break;
          default: // Do nothing
        }

        return null;
      }

      render(
        <ApolloProvider client={client}>
          <App />
        </ApolloProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(3);
      }).then(resolve, reject);
    });
  });

  describe('Skipping', () => {
    itAsync('should skip running a query when `skip` is `true`', (resolve, reject) => {
      let renderCount = 0;

      const Component = () => {
        const [skip, setSkip] = useState(true);
        const { loading, data } = useQuery(CAR_QUERY, { skip });

        switch (++renderCount) {
          case 1:
            expect(loading).toBeFalsy();
            expect(data).toBeUndefined();
            setTimeout(() => setSkip(false));
            break;
          case 2:
            expect(loading).toBeTruthy();
            expect(data).toBeUndefined();
            break;
          case 3:
            expect(loading).toBeFalsy();
            expect(data).toEqual(CAR_RESULT_DATA);
            break;
          default:
            reject("too many renders");
        }

        return null;
      };

      render(
        <MockedProvider mocks={CAR_MOCKS}>
          <Component />
        </MockedProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(3);
      }).then(resolve, reject);
    });

    itAsync('should not make network requests when `skip` is `true`', (resolve, reject) => {
      let networkRequestCount = 0;
      const link = new ApolloLink((o, f) => {
        networkRequestCount += 1;
        return f ? f(o) : null;
      }).concat(mockSingleLink(
        {
          request: {
            query: CAR_QUERY,
            variables: { someVar: true }
          },
          result: { data: CAR_RESULT_DATA }
        }
      ));

      const client = new ApolloClient({
        link,
        cache: new InMemoryCache()
      });

      let renderCount = 0;
      const Component = () => {
        const [skip, setSkip] = useState(false);
        const { loading, data } = useQuery(CAR_QUERY, {
          fetchPolicy: 'no-cache',
          skip,
          variables: { someVar: !skip }
        });

        switch (++renderCount) {
          case 1:
            expect(loading).toBeTruthy();
            expect(data).toBeUndefined();
            break;
          case 2:
            expect(loading).toBeFalsy();
            expect(data).toEqual(CAR_RESULT_DATA);
            expect(networkRequestCount).toBe(1);
            setTimeout(() => setSkip(true));
            break;
          case 3:
            expect(loading).toBeFalsy();
            expect(data).toBeUndefined();
            expect(networkRequestCount).toBe(1);
            break;
          default:
            reject('too many renders');
        }

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

    it('should tear down the query if `skip` is `true`', () => {
      const client = new ApolloClient({
        link: new ApolloLink(),
        cache: new InMemoryCache()
      });

      const Component = () => {
        useQuery(CAR_QUERY, { skip: true });
        return null;
      };

      const app = render(
        <ApolloProvider client={client}>
          <Component />
        </ApolloProvider>
      );

      expect(client['queryManager']['queries'].size).toBe(1);

      app.unmount();

      return wait(() => {
        expect(client['queryManager']['queries'].size).toBe(0);
      });
    });
  });

  describe('Missing Fields', () => {
    itAsync(
      'should have errors populated with missing field errors from the cache',
      (resolve, reject) => {
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

        const carData = {
          cars: [
            {
              id: 1,
              make: 'Audi',
              model: 'RS8',
              vine: 'DOLLADOLLABILL',
              __typename: 'Car'
            }
          ]
        };

        const mocks = [
          {
            request: { query: carQuery, variables: { id: 1 } },
            result: { data: carData }
          },
        ];

        let renderCount = 0;
        function App() {
          const { loading, data, error } = useQuery(carQuery, {
            variables: { id: 1 },
          });

          switch (renderCount) {
            case 0:
              expect(loading).toBeTruthy();
              expect(data).toBeUndefined();
              expect(error).toBeUndefined();
              break;
            case 1:
              expect(loading).toBeFalsy();
              expect(data).toBeUndefined();
              expect(error).toBeDefined();
              // TODO: ApolloError.name is Error for some reason
              // expect(error!.name).toBe(ApolloError);
              expect(error!.clientErrors.length).toEqual(1);
              expect(error!.message).toMatch(/Can't find field 'vin' on Car:1/);
              break;
            default:
              throw new Error("Unexpected render");
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
          expect(renderCount).toBe(2);
        }).then(resolve, reject);
      },
    );
  });

  describe('Previous data', () => {
    itAsync('should persist previous data when a query is re-run', (resolve, reject) => {
      const query = gql`
        query car {
          car {
            id
            make
          }
        }
      `;

      const data1 = {
        car: {
          id: 1,
          make: 'Venturi',
          __typename: 'Car',
        }
      };

      const data2 = {
        car: {
          id: 2,
          make: 'Wiesmann',
          __typename: 'Car',
        }
      };

      const mocks = [
        { request: { query }, result: { data: data1 } },
        { request: { query }, result: { data: data2 } }
      ];

      let renderCount = 0;
      function App() {
        const { loading, data, previousData, refetch } = useQuery(query, {
          notifyOnNetworkStatusChange: true,
        });

        switch (++renderCount) {
          case 1:
            expect(loading).toBeTruthy();
            expect(data).toBeUndefined();
            expect(previousData).toBeUndefined();
            break;
          case 2:
            expect(loading).toBeFalsy();
            expect(data).toEqual(data1);
            expect(previousData).toBeUndefined();
            setTimeout(refetch);
            break;
          case 3:
            expect(loading).toBeTruthy();
            expect(data).toEqual(data1);
            expect(previousData).toEqual(data1);
            break;
          case 4:
            expect(loading).toBeFalsy();
            expect(data).toEqual(data2);
            expect(previousData).toEqual(data1);
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

    itAsync('should persist result.previousData across multiple results', (resolve, reject) => {
      const query: TypedDocumentNode<{
        car: {
          id: string;
          make: string;
        };
      }, {
        vin?: string;
      }> = gql`
        query car($vin: String) {
          car(vin: $vin) {
            id
            make
          }
        }
      `;

      const data1 = {
        car: {
          id: 1,
          make: 'Venturi',
          __typename: 'Car',
        }
      };

      const data2 = {
        car: {
          id: 2,
          make: 'Wiesmann',
          __typename: 'Car',
        }
      };

      const data3 = {
        car: {
          id: 3,
          make: 'Beetle',
          __typename: 'Car',
        }
      };

      const mocks = [
        { request: { query }, result: { data: data1 } },
        { request: { query }, result: { data: data2 } },
        {
          request: {
            query,
            variables: { vin: "ABCDEFG0123456789" },
          },
          result: { data: data3 },
        },
      ];

      let renderCount = 0;
      function App() {
        const { loading, data, previousData, refetch } = useQuery(query, {
          notifyOnNetworkStatusChange: true,
        });

        switch (++renderCount) {
          case 1:
            expect(loading).toBe(true);
            expect(data).toBeUndefined();
            expect(previousData).toBeUndefined();
            break;
          case 2:
            expect(loading).toBe(false);
            expect(data).toEqual(data1);
            expect(previousData).toBeUndefined();
            setTimeout(refetch);
            break;
          case 3:
            expect(loading).toBe(true);
            expect(data).toEqual(data1);
            expect(previousData).toEqual(data1);
            // Interrupt the first refetch by refetching again with
            // variables the cache has not seen before, thereby skipping
            // data2 entirely.
            refetch({
              vin: "ABCDEFG0123456789",
            });
            break;
          case 4:
            expect(loading).toBe(true);
            expect(data).toBeUndefined();
            expect(previousData).toEqual(data1);
            break;
          case 5:
            expect(loading).toBe(false);
            expect(data).toEqual(data3);
            expect(previousData).toEqual(data1);
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
        expect(renderCount).toBe(5);
      }).then(resolve, reject);
    });

    itAsync("should be cleared when variables change causes cache miss", (resolve, reject) => {
      const peopleData = [
        { id: 1, name: 'John Smith', gender: 'male' },
        { id: 2, name: 'Sara Smith', gender: 'female' },
        { id: 3, name: 'Budd Deey', gender: 'nonbinary' },
        { id: 4, name: 'Johnny Appleseed', gender: 'male' },
        { id: 5, name: 'Ada Lovelace', gender: 'female' },
      ];

      const link = new ApolloLink(operation => {
        return new Observable(observer => {
          const { gender } = operation.variables;
          new Promise(resolve => setTimeout(resolve, 300)).then(() => {
            observer.next({
              data: {
                people: gender === "all" ? peopleData :
                  gender ? peopleData.filter(
                    person => person.gender === gender
                  ) : peopleData,
              }
            });
            observer.complete();
          });
        });
      });

      type Person = {
        __typename: string;
        id: string;
        name: string;
      };

      const ALL_PEOPLE: TypedDocumentNode<{
        people: Person[];
      }> = gql`
        query AllPeople($gender: String!) {
          people(gender: $gender) {
            id
            name
          }
        }
      `;

      let renderCount = 0;
      function App() {
        const [gender, setGender] = useState("all");
        const {
          loading,
          networkStatus,
          data,
        } = useQuery(ALL_PEOPLE, {
          variables: { gender },
          fetchPolicy: "network-only",
        });

        const currentPeopleNames = data?.people?.map(person => person.name);

        switch (++renderCount) {
          case 1:
            expect(gender).toBe("all");
            expect(loading).toBe(true);
            expect(networkStatus).toBe(NetworkStatus.loading);
            expect(data).toBeUndefined();
            expect(currentPeopleNames).toBeUndefined();
            break;

          case 2:
            expect(gender).toBe("all");
            expect(loading).toBe(false);
            expect(networkStatus).toBe(NetworkStatus.ready);
            expect(data).toEqual({
              people: peopleData.map(({ gender, ...person }) => person),
            });
            expect(currentPeopleNames).toEqual([
              "John Smith",
              "Sara Smith",
              "Budd Deey",
              "Johnny Appleseed",
              "Ada Lovelace",
            ]);
            act(() => {
              setGender("female");
            });
            break;

          case 3:
            expect(gender).toBe("female");
            expect(loading).toBe(true);
            expect(networkStatus).toBe(NetworkStatus.setVariables);
            expect(data).toBeUndefined();
            expect(currentPeopleNames).toBeUndefined();
            break;

          case 4:
            expect(gender).toBe("female");
            expect(loading).toBe(false);
            expect(networkStatus).toBe(NetworkStatus.ready);
            expect(data!.people.length).toBe(2);
            expect(currentPeopleNames).toEqual([
              "Sara Smith",
              "Ada Lovelace",
            ]);
            act(() => {
              setGender("nonbinary");
            });
            break;

          case 5:
            expect(gender).toBe("nonbinary");
            expect(loading).toBe(true);
            expect(networkStatus).toBe(NetworkStatus.setVariables);
            expect(data).toBeUndefined();
            expect(currentPeopleNames).toBeUndefined();
            break;

          case 6:
            expect(gender).toBe("nonbinary");
            expect(loading).toBe(false);
            expect(networkStatus).toBe(NetworkStatus.ready);
            expect(data!.people.length).toBe(1);
            expect(currentPeopleNames).toEqual([
              "Budd Deey",
            ]);
            act(() => {
              setGender("male");
            });
            break;

          case 7:
            expect(gender).toBe("male");
            expect(loading).toBe(true);
            expect(networkStatus).toBe(NetworkStatus.setVariables);
            expect(data).toBeUndefined();
            expect(currentPeopleNames).toBeUndefined();
            break;

          case 8:
            expect(gender).toBe("male");
            expect(loading).toBe(false);
            expect(networkStatus).toBe(NetworkStatus.ready);
            expect(data!.people.length).toBe(2);
            expect(currentPeopleNames).toEqual([
              "John Smith",
              "Johnny Appleseed",
            ]);
            act(() => {
              setGender("female");
            });
            break;

          case 9:
            expect(gender).toBe("female");
            expect(loading).toBe(true);
            expect(networkStatus).toBe(NetworkStatus.setVariables);
            expect(data!.people.length).toBe(2);
            expect(currentPeopleNames).toEqual([
              "Sara Smith",
              "Ada Lovelace",
            ]);
            break;

          case 10:
            expect(gender).toBe("female");
            expect(loading).toBe(false);
            expect(networkStatus).toBe(NetworkStatus.ready);
            expect(data!.people.length).toBe(2);
            expect(currentPeopleNames).toEqual([
              "Sara Smith",
              "Ada Lovelace",
            ]);
            act(() => {
              setGender("all");
            });
            break;

          case 11:
            expect(gender).toBe("all");
            expect(loading).toBe(true);
            expect(networkStatus).toBe(NetworkStatus.setVariables);
            expect(data!.people.length).toBe(5);
            expect(currentPeopleNames).toEqual([
              "John Smith",
              "Sara Smith",
              "Budd Deey",
              "Johnny Appleseed",
              "Ada Lovelace",
            ]);
            break;

          case 12:
            expect(gender).toBe("all");
            expect(loading).toBe(false);
            expect(networkStatus).toBe(NetworkStatus.ready);
            expect(data!.people.length).toBe(5);
            expect(currentPeopleNames).toEqual([
              "John Smith",
              "Sara Smith",
              "Budd Deey",
              "Johnny Appleseed",
              "Ada Lovelace",
            ]);
            break;

          default:
            reject(`too many (${renderCount}) renders`);
        }

        return null;
      }

      const client = new ApolloClient({
        cache: new InMemoryCache(),
        link
      });

      render(
        <ApolloProvider client={client}>
          <App />
        </ApolloProvider>,
      );

      return wait(() => {
        expect(renderCount).toBe(12);
      }).then(resolve, reject);
    });
  });

  describe("canonical cache results", () => {
    itAsync("can be disabled via useQuery options", (resolve, reject) => {
      const cache = new InMemoryCache({
        typePolicies: {
          Result: {
            keyFields: false,
          },
        },
      });

      const query = gql`
        query {
          results {
            value
          }
        }
      `;

      const results = [
        { __typename: "Result", value: 0 },
        { __typename: "Result", value: 1 },
        { __typename: "Result", value: 1 },
        { __typename: "Result", value: 2 },
        { __typename: "Result", value: 3 },
        { __typename: "Result", value: 5 },
      ];

      cache.writeQuery({
        query,
        data: { results },
      })

      let renderCount = 0;
      function App() {
        const [canonizeResults, setCanonize] = useState(false);
        const { loading, data } = useQuery(query, {
          fetchPolicy: "cache-only",
          canonizeResults,
        });

        switch (++renderCount) {
          case 1: {
            expect(loading).toBe(false);
            expect(data).toEqual({ results });
            expect(data.results.length).toBe(6);
            const resultSet = new Set(data.results as typeof results);
            // Since canonization is not happening, the duplicate 1 results are
            // returned as distinct objects.
            expect(resultSet.size).toBe(6);
            act(() => setCanonize(true));
            break;
          }

          case 2: {
            expect(loading).toBe(false);
            expect(data).toEqual({ results });
            expect(data.results.length).toBe(6);
            const resultSet = new Set(data.results as typeof results);
            // Since canonization is happening now, the duplicate 1 results are
            // returned as identical (===) objects.
            expect(resultSet.size).toBe(5);
            const values: number[] = [];
            resultSet.forEach(result => values.push(result.value));
            expect(values).toEqual([0, 1, 2, 3, 5]);
            act(() => {
              results.push({
                __typename: "Result",
                value: 8,
              });
              // Append another element to the results array, invalidating the
              // array itself, triggering another render (below).
              cache.writeQuery({
                query,
                overwrite: true,
                data: { results },
              });
            });
            break;
          }

          case 3: {
            expect(loading).toBe(false);
            expect(data).toEqual({ results });
            expect(data.results.length).toBe(7);
            const resultSet = new Set(data.results as typeof results);
            // Since canonization is happening now, the duplicate 1 results are
            // returned as identical (===) objects.
            expect(resultSet.size).toBe(6);
            const values: number[] = [];
            resultSet.forEach(result => values.push(result.value));
            expect(values).toEqual([0, 1, 2, 3, 5, 8]);
            break;
          }

          default: {
            reject("too many renders");
          }
        }

        return null;
      }

      render(
        <MockedProvider cache={cache}>
          <App/>
        </MockedProvider>
      );

      return wait(() => {
        expect(renderCount).toBe(3);
      }).then(resolve, reject);
    });
  });

  describe("multiple useQuery calls per component", () => {
    type ABFields = {
      id: number;
      name: string;
    };

    const aQuery: TypedDocumentNode<{
      a: ABFields;
    }> = gql`query A { a { id name }}`;

    const bQuery: TypedDocumentNode<{
      b: ABFields;
    }> = gql`query B { b { id name }}`;

    const aData = {
      a: {
        __typename: "A",
        id: 65,
        name: "ay",
      },
    };

    const bData = {
      b: {
        __typename: "B",
        id: 66,
        name: "bee",
      },
    };

    function makeClient() {
      return new ApolloClient({
        cache: new InMemoryCache,
        link: new ApolloLink(operation => new Observable(observer => {
          switch (operation.operationName) {
            case "A":
              observer.next({ data: aData });
              break;
            case "B":
              observer.next({ data: bData });
              break;
          }
          observer.complete();
        })),
      });
    }

    function check(
      aFetchPolicy: WatchQueryFetchPolicy,
      bFetchPolicy: WatchQueryFetchPolicy,
    ) {
      return (
        resolve: (result: any) => any,
        reject: (reason: any) => any,
      ) => {
        let renderCount = 0;

        function App() {
          const a = useQuery(aQuery, {
            fetchPolicy: aFetchPolicy,
          });

          const b = useQuery(bQuery, {
            fetchPolicy: bFetchPolicy,
          });

          switch (++renderCount) {
            case 1:
              expect(a.loading).toBe(true);
              expect(b.loading).toBe(true);
              expect(a.data).toBeUndefined();
              expect(b.data).toBeUndefined();
              break;
            case 2:
              expect(a.loading).toBe(false);
              expect(b.loading).toBe(true);
              expect(a.data).toEqual(aData);
              expect(b.data).toBeUndefined();
              break;
            case 3:
              expect(a.loading).toBe(false);
              expect(b.loading).toBe(false);
              expect(a.data).toEqual(aData);
              expect(b.data).toEqual(bData);
              break;
            default:
              reject("too many renders: " + renderCount);
          }

          return null;
        }

        render(
          <ApolloProvider client={makeClient()}>
            <App/>
          </ApolloProvider>
        );

        return wait(() => {
          expect(renderCount).toBe(3);
        }).then(resolve, reject);
      };
    }

    itAsync("cache-first for both", check(
      "cache-first",
      "cache-first",
    ));

    itAsync("cache-first first, cache-and-network second", check(
      "cache-first",
      "cache-and-network",
    ));

    itAsync("cache-first first, network-only second", check(
      "cache-first",
      "network-only",
    ));

    itAsync("cache-and-network for both", check(
      "cache-and-network",
      "cache-and-network",
    ));

    itAsync("cache-and-network first, cache-first second", check(
      "cache-and-network",
      "cache-first",
    ));

    itAsync("cache-and-network first, network-only second", check(
      "cache-and-network",
      "network-only",
    ));

    itAsync("network-only for both", check(
      "network-only",
      "network-only",
    ));

    itAsync("network-only first, cache-first second", check(
      "network-only",
      "cache-first",
    ));

    itAsync("network-only first, cache-and-network second", check(
      "network-only",
      "cache-and-network",
    ));
  });
});
