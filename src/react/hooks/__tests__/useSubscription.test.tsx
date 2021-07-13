import React from 'react';
import { render, cleanup, wait } from '@testing-library/react';
import gql from 'graphql-tag';

import { ApolloClient, ApolloLink, concat } from '../../../core';
import { InMemoryCache as Cache } from '../../../cache';
import { ApolloProvider } from '../../context';
import { MockSubscriptionLink, withErrorSpy } from '../../../testing';
import { useSubscription } from '../useSubscription';

describe('useSubscription Hook', () => {
  afterEach(cleanup);

  it('should handle a simple subscription properly', async () => {
    const subscription = gql`
      subscription {
        car {
          make
        }
      }
    `;

    const results = ['Audi', 'BMW', 'Mercedes', 'Hyundai'].map(make => ({
      result: { data: { car: { make } } }
    }));

    const link = new MockSubscriptionLink();
    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });

    let renderCount = 0;
    const Component = () => {
      const { loading, data, error } = useSubscription(subscription);
      switch (renderCount) {
        case 0:
          expect(loading).toBe(true);
          expect(error).toBeUndefined();
          expect(data).toBeUndefined();
          break;
        case 1:
          expect(loading).toBe(false);
          expect(data).toEqual(results[0].result.data);
          break;
        case 2:
          expect(loading).toBe(false);
          expect(data).toEqual(results[1].result.data);
          break;
        case 3:
          expect(loading).toBe(false);
          expect(data).toEqual(results[2].result.data);
          break;
        case 4:
          expect(loading).toBe(false);
          expect(data).toEqual(results[3].result.data);
          break;
        default:
      }
      setTimeout(() => {
        renderCount <= results.length &&
          link.simulateResult(results[renderCount - 1]);
      });
      renderCount += 1;
      return null;
    };

    render(
      <ApolloProvider client={client}>
        <Component />
      </ApolloProvider>
    );

    return wait(() => {
      expect(renderCount).toBe(5);
    });
  });

  it('should cleanup after the subscription component has been unmounted', async () => {
    const subscription = gql`
      subscription {
        car {
          make
        }
      }
    `;

    const results = [
      {
        result: { data: { car: { make: 'Pagani' } } }
      }
    ];

    const link = new MockSubscriptionLink();
    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });

    let renderCount = 0;
    let onSubscriptionDataCount = 0;
    let unmount: any;

    const Component = () => {
      const { loading, data, error } = useSubscription(subscription, {
        onSubscriptionData() {
          onSubscriptionDataCount += 1;
        }
      });
      switch (renderCount) {
        case 0:
          expect(loading).toBe(true);
          expect(error).toBeUndefined();
          expect(data).toBeUndefined();
          link.simulateResult(results[0]);
          break;
        case 1:
          expect(loading).toBe(false);
          expect(data).toEqual(results[0].result.data);

          setTimeout(() => {
            expect(onSubscriptionDataCount).toEqual(1);

            // After the component has been unmounted, the internal
            // ObservableQuery should be stopped, meaning it shouldn't
            // receive any new data (so the onSubscriptionDataCount should
            // stay at 1).
            unmount();
            link.simulateResult(results[0]);
          });
          break;
        default:
      }
      renderCount += 1;
      return null;
    };

    unmount = render(
      <ApolloProvider client={client}>
        <Component />
      </ApolloProvider>
    ).unmount;

    return wait(() => {
      expect(onSubscriptionDataCount).toEqual(1);
    });
  });

  it('should never execute a subscription with the skip option', async () => {
    const subscription = gql`
      subscription {
        car {
          make
        }
      }
    `;

    const link = new MockSubscriptionLink();
    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });

    let renderCount = 0;
    let onSubscriptionDataCount = 0;
    let unmount: any;

    const Component = () => {
      const { loading, data, error } = useSubscription(subscription, {
        skip: true,
        onSubscriptionData() {
          onSubscriptionDataCount += 1;
        }
      });
      switch (renderCount) {
        case 0:
          expect(loading).toBe(false);
          expect(error).toBeUndefined();
          expect(data).toBeUndefined();
          setTimeout(() => {
            unmount();
          });
          break;
        default:
      }
      renderCount += 1;
      return null;
    };

    unmount = render(
      <ApolloProvider client={client}>
        <Component />
      </ApolloProvider>
    ).unmount;

    return wait(() => {
      expect(onSubscriptionDataCount).toEqual(0);
      expect(renderCount).toEqual(1);
    });
  });

  it('should create a subscription after skip has changed from true to a falsy value', async () => {
    const subscription = gql`
      subscription {
        car {
          make
        }
      }
    `;

    const results = [
      {
        result: { data: { car: { make: 'Pagani' } } }
      },
      {
        result: { data: { car: { make: 'Scoop' } } }
      }
    ];

    const link = new MockSubscriptionLink();
    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });

    let renderCount = 0;
    let unmount: any;

    const Component = () => {
      const [, triggerRerender] = React.useState(0);
      const [skip, setSkip] = React.useState(true);
      const { loading, data, error } = useSubscription(subscription, {
        skip
      });
      switch (renderCount) {
        case 0:
          expect(loading).toBe(false);
          expect(error).toBeUndefined();
          expect(data).toBeUndefined();
          setSkip(false);
          break;
        case 1:
          expect(loading).toBe(true);
          expect(error).toBeUndefined();
          expect(data).toBeUndefined();
          link.simulateResult(results[0]);
          break;
        case 2:
          expect(loading).toBe(false);
          expect(data).toEqual(results[0].result.data);
          setSkip(true);
          break;
        case 3:
          expect(loading).toBe(false);
          expect(data).toBeUndefined();
          expect(error).toBeUndefined();
          // ensure state persists across rerenders
          triggerRerender(i => i + 1);
          break;
        case 4:
          expect(loading).toBe(false);
          expect(data).toBeUndefined();
          expect(error).toBeUndefined();
          setSkip(false);
          break;
        case 5:
          expect(loading).toBe(true);
          expect(error).toBeUndefined();
          expect(data).toBeUndefined();
          link.simulateResult(results[1]);
          break;
        case 6:
          expect(loading).toBe(false);
          expect(error).toBeUndefined();
          expect(data).toEqual(results[1].result.data);
          setTimeout(() => {
            unmount();
          });
          break;
        default:
      }
      renderCount += 1;
      return null;
    };

    unmount = render(
      <ApolloProvider client={client}>
        <Component />
      </ApolloProvider>
    ).unmount;

    return wait(() => {
      expect(renderCount).toEqual(7);
    });
  });

  it('should share context set in options', async () => {
    const subscription = gql`
      subscription {
        car {
          make
        }
      }
    `;

    const results = ['Audi', 'BMW'].map(make => ({
      result: { data: { car: { make } } }
    }));

    let context: string;
    const link = new MockSubscriptionLink();
    const contextLink = new ApolloLink((operation, forward) => {
      context = operation.getContext()?.make
      return forward(operation);
    });
    const client = new ApolloClient({
      link: concat(contextLink, link),
      cache: new Cache({ addTypename: false })
    });

    let renderCount = 0;
    const Component = () => {
      const { loading, data, error } = useSubscription(subscription, {
        context: {
          make: 'Audi',
        },
      });
      switch (renderCount) {
        case 0:
          expect(loading).toBe(true);
          expect(error).toBeUndefined();
          expect(data).toBeUndefined();
          break;
        case 1:
          expect(loading).toBe(false);
          expect(data).toEqual(results[0].result.data);
          break;
        case 2:
          expect(loading).toBe(false);
          expect(data).toEqual(results[1].result.data);
          break;
        default:
      }
      setTimeout(() => {
        renderCount <= results.length &&
          link.simulateResult(results[renderCount - 1]);
      });
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
      expect(context).toEqual('Audi');
    });
  });

  it('should handle multiple subscriptions properly', () => {
    const subscription = gql`
      subscription {
        car {
          make
        }
      }
    `;

    const results = ['Audi', 'BMW'].map(make => ({
      result: { data: { car: { make } } }
    }));

    const link = new MockSubscriptionLink();
    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });

    let renderCount = 0;
    const Component = () => {
      const { loading: loading1, data: data1, error: error1 } = useSubscription(subscription);
      const { loading: loading2, data: data2, error: error2 } = useSubscription(subscription);
      switch (renderCount) {
        case 0:
          expect(loading1).toBe(true);
          expect(error1).toBeUndefined();
          expect(data1).toBeUndefined();
          expect(loading2).toBe(true);
          expect(error2).toBeUndefined();
          expect(data2).toBeUndefined();
          break;
        case 1:
          expect(loading1).toBe(false);
          expect(data1).toEqual(results[0].result.data);
          expect(loading2).toBe(true);
          expect(data2).toBe(undefined);
          break;
        case 2:
          expect(loading1).toBe(false);
          expect(data1).toEqual(results[0].result.data);
          expect(loading2).toBe(false);
          expect(data2).toEqual(results[0].result.data);
          break;
        case 3:
          expect(loading1).toBe(false);
          expect(data1).toEqual(results[1].result.data);
          expect(loading2).toBe(false);
          expect(data2).toEqual(results[0].result.data);
          break;
        case 4:
          expect(loading1).toBe(false);
          expect(data1).toEqual(results[1].result.data);
          expect(loading2).toBe(false);
          expect(data2).toEqual(results[1].result.data);
          break;
        default:
      }

      renderCount += 1;
      return null;
    };

    for (let i = 0; i < results.length; i++) {
      setTimeout(() => {
        link.simulateResult(results[i]);
      });
    }

    render(
      <ApolloProvider client={client}>
        <Component />
      </ApolloProvider>
    );

    return wait(() => {
      expect(renderCount).toBe(5);
    });
  });

  withErrorSpy(it, 'should handle immediate completions gracefully', () => {
    const subscription = gql`
      subscription {
        car {
          make
        }
      }
    `;

    const result = {
      result: { data: null },
    };

    const link = new MockSubscriptionLink();
    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });

    let renderCount = 0;
    const Component = () => {
      const { loading, data, error } = useSubscription(subscription);
      switch (renderCount) {
        case 0:
          expect(loading).toBe(true);
          expect(data).toBeUndefined();
          expect(error).toBeUndefined();
          break;
        case 1:
          expect(loading).toBe(false);
          expect(data).toBe(null);
          break;
        case 2:
          throw new Error("Infinite rendering detected");
        default:
          console.log(renderCount, {loading, data, error});
      }

      renderCount += 1;
      return null;
    };

    // Simulating the behavior of HttpLink, which calls next and complete in sequence.
    link.simulateResult(result, /* complete */ true);
    render(
      <ApolloProvider client={client}>
        <Component />
      </ApolloProvider>
    );

    return wait(() => {
      expect(renderCount).toBe(2);
    });
  });

  withErrorSpy(it, 'should handle immediate completions with multiple subscriptions gracefully', () => {
    const subscription = gql`
      subscription {
        car {
          make
        }
      }
    `;

    const result = {
      result: { data: null },
    };

    const link = new MockSubscriptionLink();
    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });

    let renderCount = 0;
    const Component = () => {
      const result1 = useSubscription(subscription);
      const result2 = useSubscription(subscription);
      const result3 = useSubscription(subscription);
      switch (renderCount) {
        case 0:
          expect(result1).toEqual({loading: true, data: undefined, error: undefined});
          expect(result2).toEqual({loading: true, data: undefined, error: undefined});
          expect(result3).toEqual({loading: true, data: undefined, error: undefined});
          break;
        case 1:
          expect(result1).toEqual({loading: false, data: null, error: undefined});
          expect(result2).toEqual({loading: true, data: undefined, error: undefined});
          expect(result3).toEqual({loading: true, data: undefined, error: undefined});
          break;
        case 2:
          expect(result1).toEqual({loading: false, data: null, error: undefined});
          expect(result2).toEqual({loading: false, data: null, error: undefined});
          expect(result3).toEqual({loading: true, data: undefined, error: undefined});
          break;
        case 3:
          expect(result1).toEqual({loading: false, data: null, error: undefined});
          expect(result2).toEqual({loading: false, data: null, error: undefined});
          expect(result3).toEqual({loading: false, data: null, error: undefined});
          break;
        case 4:
          throw new Error("Infinite rendering detected");
        default:
      }

      renderCount += 1;
      return null;
    };

    // Simulating the behavior of HttpLink, which calls next and complete in sequence.
    link.simulateResult(result, /* complete */ true);
    render(
      <ApolloProvider client={client}>
        <Component />
      </ApolloProvider>
    );

    return wait(() => {
      expect(renderCount).toBe(4);
    });
  });
});
