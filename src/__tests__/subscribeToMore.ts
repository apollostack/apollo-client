import gql from 'graphql-tag';
import type { DocumentNode, OperationDefinitionNode } from 'graphql';

import { ApolloLink } from '../link/core/ApolloLink';
import type { Operation } from '../link/core/types';
import { mockSingleLink } from '../utilities/testing/mocking/mockLink';
import { mockObservableLink } from '../utilities/testing/mocking/mockSubscriptionLink';
import { ApolloClient } from '../';
import { InMemoryCache } from '../cache/inmemory/inMemoryCache';
import { stripSymbols } from '../utilities/testing/stripSymbols';
import { itAsync } from '../utilities/testing/itAsync';

const isSub = (operation: Operation) =>
  (operation.query as DocumentNode).definitions
    .filter(x => x.kind === 'OperationDefinition')
    .some((x: OperationDefinitionNode) => x.operation === 'subscription');

describe('subscribeToMore', () => {
  const query = gql`
    query aQuery {
      entry {
        value
      }
    }
  `;
  const result = {
    data: {
      entry: {
        value: '1',
      },
    },
  };

  const req1 = { request: { query } as Operation, result };

  const results = ['Dahivat Pandya', 'Amanda Liu'].map(name => ({
    result: { data: { name } },
    delay: 10,
  }));

  const results2 = [
    { result: { data: { name: 'Amanda Liu' } }, delay: 10 },
    { error: new Error('You cant touch this'), delay: 10 },
  ];

  const results3 = [
    { error: new Error('You cant touch this'), delay: 10 },
    { result: { data: { name: 'Amanda Liu' } }, delay: 10 },
  ];

  const result4 = {
    data: {
      entry: [{ value: '1' }, { value: '2' }],
    },
  };
  const req4 = { request: { query } as Operation, result: result4 };

  interface SubscriptionData {
    name: string;
  }

  itAsync('triggers new result from subscription data', (resolve, reject) => {
    let latestResult: any = null;
    const wSLink = mockObservableLink();
    const httpLink = mockSingleLink(req1).setOnError(reject);

    const link = ApolloLink.split(isSub, wSLink, httpLink);
    let counter = 0;

    const client = new ApolloClient({
      cache: new InMemoryCache({ addTypename: false }),
      link,
    });

    const obsHandle = client.watchQuery({ query });

    const sub = obsHandle.subscribe({
      next(queryResult: any) {
        latestResult = queryResult;
        if (++counter === 3) {
          sub.unsubscribe();
          expect(latestResult).toEqual({
            data: { entry: { value: 'Amanda Liu' } },
            loading: false,
            networkStatus: 7,
          });
          resolve();
        }
      },
    });

    obsHandle.subscribeToMore<SubscriptionData>({
      document: gql`
        subscription newValues {
          name
        }
      `,
      updateQuery: (_, { subscriptionData }) => {
        return { entry: { value: subscriptionData.data.name } };
      },
    });

    let i = 0;
    function simulate() {
      const result = results[i++];
      if (result) {
        wSLink.simulateResult(result);
        setTimeout(simulate, 10);
      }
    }
    simulate();
  });

  itAsync('calls error callback on error', (resolve, reject) => {
    let latestResult: any = null;
    const wSLink = mockObservableLink();
    const httpLink = mockSingleLink(req1).setOnError(reject);

    const link = ApolloLink.split(isSub, wSLink, httpLink);

    let counter = 0;

    const client = new ApolloClient({
      link,
      cache: new InMemoryCache({ addTypename: false }),
    });

    const obsHandle = client.watchQuery<typeof req1['result']['data']>({
      query,
    });
    const sub = obsHandle.subscribe({
      next(queryResult: any) {
        latestResult = queryResult;
        counter++;
      },
    });

    let errorCount = 0;

    obsHandle.subscribeToMore<SubscriptionData>({
      document: gql`
        subscription newValues {
          name
        }
      `,
      updateQuery: (_, { subscriptionData }) => {
        return { entry: { value: subscriptionData.data.name } };
      },
      onError: () => {
        errorCount += 1;
      },
    });

    setTimeout(() => {
      sub.unsubscribe();
      expect(stripSymbols(latestResult)).toEqual({
        data: { entry: { value: 'Amanda Liu' } },
        loading: false,
        networkStatus: 7,
      });
      expect(counter).toBe(2);
      expect(errorCount).toBe(1);
      resolve();
    }, 15);

    for (let i = 0; i < 2; i++) {
      wSLink.simulateResult(results2[i]);
    }
  });

  itAsync('prints unhandled subscription errors to the console', (resolve, reject) => {
    let latestResult: any = null;

    const wSLink = mockObservableLink();
    const httpLink = mockSingleLink(req1).setOnError(reject);

    const link = ApolloLink.split(isSub, wSLink, httpLink);

    let counter = 0;

    const client = new ApolloClient({
      link,
      cache: new InMemoryCache({ addTypename: false }),
    });

    const obsHandle = client.watchQuery({
      query,
    });
    const sub = obsHandle.subscribe({
      next(queryResult: any) {
        latestResult = queryResult;
        counter++;
      },
    });

    let errorCount = 0;
    const consoleErr = console.error;
    console.error = (_: Error) => {
      errorCount += 1;
    };

    obsHandle.subscribeToMore({
      document: gql`
        subscription newValues {
          name
        }
      `,
      updateQuery: () => {
        throw new Error('should not be called because of initial error');
      },
    });

    setTimeout(() => {
      sub.unsubscribe();
      expect(stripSymbols(latestResult)).toEqual({
        data: { entry: { value: '1' } },
        loading: false,
        networkStatus: 7,
      });
      expect(counter).toBe(1);
      expect(errorCount).toBe(1);
      console.error = consoleErr;
      resolve();
    }, 15);

    for (let i = 0; i < 2; i++) {
      wSLink.simulateResult(results3[i]);
    }
  });

  itAsync('should not corrupt the cache (#3062)', async (resolve, reject) => {
    let latestResult: any = null;
    const wSLink = mockObservableLink();
    const httpLink = mockSingleLink(req4).setOnError(reject);

    const link = ApolloLink.split(isSub, wSLink, httpLink);
    let counter = 0;

    const client = new ApolloClient({
      cache: new InMemoryCache({ addTypename: false }).restore({
        ROOT_QUERY: {
          entry: [
            {
              value: 1,
            },
            {
              value: 2,
            },
          ],
        },
      }),
      link,
    });

    const obsHandle = client.watchQuery<typeof req4['result']['data']>({
      query,
    });

    const sub = obsHandle.subscribe({
      next(queryResult: any) {
        latestResult = queryResult;
        counter++;
      },
    });

    let nextMutation: { value: string };
    obsHandle.subscribeToMore<SubscriptionData>({
      document: gql`
        subscription createdEntry {
          name
        }
      `,
      updateQuery: (prev, { subscriptionData }) => {
        expect(prev.entry).not.toContainEqual(nextMutation);
        return {
          entry: [...prev.entry, { value: subscriptionData.data.name }],
        };
      },
    });

    const wait = (dur: any) => new Promise(resolve => setTimeout(resolve, dur));

    for (let i = 0; i < 2; i++) {
      // init optimistic mutation
      let data = client.cache.readQuery<typeof req4['result']['data']>(
        { query },
        false,
      );
      client.cache.recordOptimisticTransaction(proxy => {
        nextMutation = { value: results[i].result.data.name };
        proxy.writeQuery({
          data: { entry: [...((data && data.entry) || []), nextMutation] },
          query,
        });
      }, i.toString());
      // on slow networks, subscription can happen first
      wSLink.simulateResult(results[i]);
      await wait(results[i].delay + 1);
      // complete mutation
      client.cache.removeOptimistic(i.toString());
      // note: we don't complete mutation with performTransaction because a real example would detect duplicates
    }
    sub.unsubscribe();
    expect(counter).toBe(3);
    expect(stripSymbols(latestResult)).toEqual({
      data: {
        entry: [
          {
            value: 1,
          },
          {
            value: 2,
          },
          {
            value: 'Dahivat Pandya',
          },
          {
            value: 'Amanda Liu',
          },
        ],
      },
      loading: false,
      networkStatus: 7,
    });
    resolve();
  });
  // TODO add a test that checks that subscriptions are cancelled when obs is unsubscribed from.

  itAsync('allows specification of custom types for variables and payload (#4246)', (resolve, reject) => {
    interface TypedOperation extends Operation {
      variables: {
        someNumber: number;
      };
    }
    const typedReq = {
      request: { query, variables: { someNumber: 1 } } as TypedOperation,
      result,
    };
    interface TypedSubscriptionVariables {
      someString: string;
    }

    let latestResult: any = null;
    const wSLink = mockObservableLink();
    const httpLink = mockSingleLink(typedReq).setOnError(reject);

    const link = ApolloLink.split(isSub, wSLink, httpLink);
    let counter = 0;

    const client = new ApolloClient({
      cache: new InMemoryCache({ addTypename: false }),
      link,
    });

    type TData = typeof typedReq['result']['data'];
    type TVars = typeof typedReq['request']['variables'];
    const obsHandle = client.watchQuery<TData, TVars>({
      query,
      variables: { someNumber: 1 },
    });

    const sub = obsHandle.subscribe({
      next(queryResult: any) {
        latestResult = queryResult;
        if (++counter === 3) {
          sub.unsubscribe();
          expect(latestResult).toEqual({
            data: { entry: { value: 'Amanda Liu' } },
            loading: false,
            networkStatus: 7,
          });
          resolve();
        }
      },
    });

    obsHandle.subscribeToMore<SubscriptionData, TypedSubscriptionVariables>({
      document: gql`
        subscription newValues {
          name
        }
      `,
      variables: {
        someString: 'foo',
      },
      updateQuery: (_, { subscriptionData }) => {
        return { entry: { value: subscriptionData.data.name } };
      },
    });

    let i = 0;
    function simulate() {
      const result = results[i++];
      if (result) {
        wSLink.simulateResult(result);
        setTimeout(simulate, 10);
      }
    }
    simulate();
  });
});
