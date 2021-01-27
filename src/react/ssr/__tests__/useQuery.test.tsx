import React from 'react';
import { DocumentNode } from 'graphql';
import gql from 'graphql-tag';
import { MockedProvider, mockSingleLink } from '../../../testing';
import { ApolloClient } from '../../../core';
import { InMemoryCache } from '../../../cache';
import { ApolloProvider } from '../../context';
import { useQuery } from '../../hooks';
import { render, wait } from '@testing-library/react';
import { renderToStringWithData } from '..';

describe('useQuery Hook SSR', () => {
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

  it('should support SSR', () => {
    const Component = () => {
      const { loading, data } = useQuery(CAR_QUERY);
      if (!loading) {
        expect(data).toEqual(CAR_RESULT_DATA);
        const { make, model, vin } = data.cars[0];
        return (
          <div>
            {make}, {model}, {vin}
          </div>
        );
      }
      return null;
    };

    const app = (
      <MockedProvider mocks={CAR_MOCKS}>
        <Component />
      </MockedProvider>
    );

    return renderToStringWithData(app).then(markup => {
      expect(markup).toMatch(/Audi/);
    });
  });

  it('should initialize data as `undefined` when loading', () => {
    const Component = () => {
      const { data, loading } = useQuery(CAR_QUERY);
      if (loading) {
        expect(data).toBeUndefined();
      }
      return null;
    };

    const app = (
      <MockedProvider mocks={CAR_MOCKS}>
        <Component />
      </MockedProvider>
    );

    return renderToStringWithData(app);
  });

  it('should skip SSR tree rendering if `ssr` option is `false`', async () => {
    let renderCount = 0;
    const Component = () => {
      const { data, loading } = useQuery(CAR_QUERY, { ssr: false });
      renderCount += 1;

      if (!loading) {
        const { make } = data.cars[0];
        return <div>{make}</div>;
      }
      return null;
    };

    const app = (
      <MockedProvider mocks={CAR_MOCKS}>
        <Component />
      </MockedProvider>
    );

    return renderToStringWithData(app).then(result => {
      expect(renderCount).toBe(1);
      expect(result).toEqual('');
    });
  });

  it(
    'should skip both SSR tree rendering and SSR component rendering if ' +
      '`ssr` option is `false` and `ssrMode` is `true`',
    async () => {
      const link = mockSingleLink({
        request: { query: CAR_QUERY },
        result: { data: CAR_RESULT_DATA }
      });

      const client = new ApolloClient({
        cache: new InMemoryCache(),
        link,
        ssrMode: true
      });

      let renderCount = 0;
      const Component = () => {
        const { data, loading } = useQuery(CAR_QUERY, { ssr: false });

        let content = null;
        switch (renderCount) {
          case 0:
            expect(loading).toBeTruthy();
            expect(data).toBeUndefined();
            break;
          case 1: // FAIL; should not render a second time
          default:
        }

        renderCount += 1;
        return content;
      };

      const app = (
        <ApolloProvider client={client}>
          <Component />
        </ApolloProvider>
      );

      await renderToStringWithData(app).then(result => {
        expect(renderCount).toBe(1);
        expect(result).toEqual('');
      });

      renderCount = 0;

      render(
        <ApolloProvider client={client}>
          <Component />
        </ApolloProvider>
      );

      await wait(() => {
        expect(renderCount).toBe(1);
      });
    }
  );

  it('should skip SSR tree rendering if `skip` option is `true`', async () => {
    let renderCount = 0;
    const Component = () => {
      const {
        loading,
        networkStatus,
        data,
      } = useQuery(CAR_QUERY, { skip: true });
      renderCount += 1;

      expect(loading).toBeFalsy();
      expect(networkStatus).toBe(7);
      expect(data).toBeUndefined();

      return null;
    };

    const app = (
      <MockedProvider mocks={CAR_MOCKS}>
        <Component />
      </MockedProvider>
    );

    return renderToStringWithData(app).then(result => {
      expect(renderCount).toBe(1);
      expect(result).toBe('');
    });
  });
});
