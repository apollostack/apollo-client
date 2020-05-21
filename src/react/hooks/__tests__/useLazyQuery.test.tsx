import type { DocumentNode } from 'graphql';
import gql from 'graphql-tag';
import { render, wait } from '@testing-library/react';

import { MockedProvider } from '../../../utilities/testing';
import { ApolloClient } from '../../../ApolloClient';
import { InMemoryCache } from '../../../cache/inmemory/inMemoryCache';
import { ApolloProvider } from '../../context/ApolloProvider';
import { useLazyQuery } from '../useLazyQuery';
import { requireReactLazily } from '../../react';

const React = requireReactLazily();

describe('useLazyQuery Hook', () => {
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

  it('should hold query execution until manually triggered', async () => {
    let renderCount = 0;
    const Component = () => {
      const [execute, { loading, data }] = useLazyQuery(CAR_QUERY);
      switch (renderCount) {
        case 0:
          expect(loading).toEqual(false);
          setTimeout(() => {
            execute();
          });
          break;
        case 1:
          expect(loading).toEqual(true);
          break;
        case 2:
          expect(loading).toEqual(false);
          expect(data).toEqual(CAR_RESULT_DATA);
          break;
        default: // Do nothing
      }
      renderCount += 1;
      return null;
    };

    render(
      <MockedProvider mocks={CAR_MOCKS}>
        <Component />
      </MockedProvider>
    );

    return wait(() => {
      expect(renderCount).toBe(3);
    });
  });

  it('should set `called` to false by default', () => {
    const Component = () => {
      const [, { loading, called }] = useLazyQuery(CAR_QUERY);
      expect(loading).toBeFalsy();
      expect(called).toBeFalsy();
      return null;
    };

    render(
      <MockedProvider mocks={CAR_MOCKS}>
        <Component />
      </MockedProvider>
    );
  });

  it('should set `called` to true after calling the lazy execute function', async () => {
    let renderCount = 0;
    const Component = () => {
      const [execute, { loading, called, data }] = useLazyQuery(CAR_QUERY);
      switch (renderCount) {
        case 0:
          expect(loading).toBeFalsy();
          expect(called).toBeFalsy();
          setTimeout(() => {
            execute();
          });
          break;
        case 1:
          expect(loading).toBeTruthy();
          expect(called).toBeTruthy();
          break;
        case 2:
          expect(loading).toEqual(false);
          expect(called).toBeTruthy();
          expect(data).toEqual(CAR_RESULT_DATA);
          break;
        default: // Do nothing
      }
      renderCount += 1;
      return null;
    };

    render(
      <MockedProvider mocks={CAR_MOCKS}>
        <Component />
      </MockedProvider>
    );

    return wait(() => {
      expect(renderCount).toBe(3);
    });
  });

  it('should override `skip` if lazy mode execution function is called', async () => {
    let renderCount = 0;
    const Component = () => {
      const [execute, { loading, data }] = useLazyQuery(CAR_QUERY, {
        skip: true
      } as any);
      switch (renderCount) {
        case 0:
          expect(loading).toBeFalsy();
          setTimeout(() => {
            execute();
          });
          break;
        case 1:
          expect(loading).toBeTruthy();
          break;
        case 2:
          expect(loading).toEqual(false);
          expect(data).toEqual(CAR_RESULT_DATA);
          break;
        default: // Do nothing
      }
      renderCount += 1;
      return null;
    };

    render(
      <MockedProvider mocks={CAR_MOCKS}>
        <Component />
      </MockedProvider>
    );

    return wait(() => {
      expect(renderCount).toBe(3);
    });
  });

  it(
    'should use variables defined in hook options (if any), when running ' +
      'the lazy execution function',
    async () => {
      const CAR_QUERY: DocumentNode = gql`
        query AllCars($year: Int!) {
          cars(year: $year) @client {
            make
            year
          }
        }
      `;

      const CAR_RESULT_DATA = [
        {
          make: 'Audi',
          year: 2000,
          __typename: 'Car'
        },
        {
          make: 'Hyundai',
          year: 2001,
          __typename: 'Car'
        }
      ];

      const client = new ApolloClient({
        cache: new InMemoryCache(),
        resolvers: {
          Query: {
            cars(_root, { year }) {
              return CAR_RESULT_DATA.filter(car => car.year === year);
            }
          }
        }
      });

      let renderCount = 0;
      const Component = () => {
        const [execute, { loading, data }] = useLazyQuery(CAR_QUERY, {
          variables: { year: 2001 }
        });
        switch (renderCount) {
          case 0:
            expect(loading).toBeFalsy();
            setTimeout(() => {
              execute();
            });
            break;
          case 1:
            expect(loading).toBeTruthy();
            break;
          case 2:
            expect(loading).toEqual(false);
            expect(data.cars).toEqual([CAR_RESULT_DATA[1]]);
            break;
          default: // Do nothing
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
      });
    }
  );

  it(
    'should use variables passed into lazy execution function, ' +
      'overriding similar variables defined in Hook options',
    async () => {
      const CAR_QUERY: DocumentNode = gql`
        query AllCars($year: Int!) {
          cars(year: $year) @client {
            make
            year
          }
        }
      `;

      const CAR_RESULT_DATA = [
        {
          make: 'Audi',
          year: 2000,
          __typename: 'Car'
        },
        {
          make: 'Hyundai',
          year: 2001,
          __typename: 'Car'
        }
      ];

      const client = new ApolloClient({
        cache: new InMemoryCache(),
        resolvers: {
          Query: {
            cars(_root, { year }) {
              return CAR_RESULT_DATA.filter(car => car.year === year);
            }
          }
        }
      });

      let renderCount = 0;
      const Component = () => {
        const [execute, { loading, data }] = useLazyQuery(CAR_QUERY, {
          variables: { year: 2001 }
        });
        switch (renderCount) {
          case 0:
            expect(loading).toBeFalsy();
            setTimeout(() => {
              execute({ variables: { year: 2000 } });
            });
            break;
          case 1:
            expect(loading).toBeTruthy();
            break;
          case 2:
            expect(loading).toEqual(false);
            expect(data.cars).toEqual([CAR_RESULT_DATA[0]]);
            break;
          default: // Do nothing
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
      });
    }
  );

  it(
    'should fetch data each time the execution function is called, when ' +
      'using a "network-only" fetch policy',
    async () => {
      const data1 = CAR_RESULT_DATA;

      const data2 = {
        cars: [
          {
            make: 'Audi',
            model: 'SQ5',
            vin: 'POWERANDTRUNKSPACE',
            __typename: 'Car'
          }
        ]
      };

      const mocks = [
        {
          request: {
            query: CAR_QUERY
          },
          result: { data: data1 }
        },
        {
          request: {
            query: CAR_QUERY
          },
          result: { data: data2 }
        }
      ];

      let renderCount = 0;
      const Component = () => {
        const [execute, { loading, data }] = useLazyQuery(CAR_QUERY, {
          fetchPolicy: 'network-only'
        });
        switch (renderCount) {
          case 0:
            expect(loading).toEqual(false);
            setTimeout(() => {
              execute();
            });
            break;
          case 1:
            expect(loading).toEqual(true);
            break;
          case 2:
            expect(loading).toEqual(false);
            expect(data).toEqual(data1);
            setTimeout(() => {
              execute();
            });
            break;
          case 3:
            expect(loading).toEqual(true);
            break;
          case 4:
            expect(loading).toEqual(false);
            expect(data).toEqual(data2);
            break;
          default: // Do nothing
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
        expect(renderCount).toBe(5);
      });
    }
  );
});
