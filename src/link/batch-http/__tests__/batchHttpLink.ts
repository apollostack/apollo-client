import fetchMock from 'fetch-mock';
import gql from 'graphql-tag';
import { print } from 'graphql';

import { ApolloLink } from '../../core/ApolloLink';
import { execute } from '../../core/execute';
import { Observable } from '../../../utilities/observables/Observable';
import { BatchHttpLink } from '../batchHttpLink';

const sampleQuery = gql`
  query SampleQuery {
    stub {
      id
    }
  }
`;

const sampleMutation = gql`
  mutation SampleMutation {
    stub {
      id
    }
  }
`;

const makeCallback = (done: any, body: any) => {
  return (...args: any[]) => {
    try {
      body(...args);
      done();
    } catch (error) {
      done.fail(error);
    }
  };
};

describe('BatchHttpLink', () => {
  beforeAll(() => {
    jest.resetModules();
  });

  const headers = { cookie: 'monster' };
  const data = { data: { hello: 'world' } };
  const data2 = { data: { hello: 'everyone' } };
  const roflData = { data: { haha: 'hehe' } };
  const lawlData = { data: { tehe: 'haaa' } };
  const makePromise = (res: any) =>
    new Promise((resolve, reject) =>
      setTimeout(() =>
        resolve({
          headers,
          body: res,
        }),
      ),
    );

  beforeEach(() => {
    fetchMock.restore();
    fetchMock.post('begin:/batch', makePromise([data, data2]));
    fetchMock.post('begin:/rofl', makePromise([roflData, roflData]));
    fetchMock.post('begin:/lawl', makePromise([lawlData, lawlData]));
  });

  it('does not need any constructor arguments', () => {
    expect(() => new BatchHttpLink()).not.toThrow();
  });

  it('handles batched requests', done => {
    const clientAwareness = {
      name: 'Some Client Name',
      version: '1.0.1',
    };

    const link = new BatchHttpLink({
      uri: '/batch',
      batchInterval: 0,
      batchMax: 2,
    });

    let nextCalls = 0;
    let completions = 0;
    const next = (expectedData: any) => (data: any) => {
      try {
        expect(data).toEqual(expectedData);
        nextCalls++;
      } catch (error) {
        done.fail(error);
      }
    };

    const complete = () => {
      try {
        const calls = fetchMock.calls('begin:/batch');
        expect(calls.length).toBe(1);
        expect(nextCalls).toBe(2);

        const options: any = fetchMock.lastOptions('begin:/batch');
        expect(options.credentials).toEqual('two');

        const { headers } = options;
        expect(headers['apollographql-client-name']).toBeDefined();
        expect(headers['apollographql-client-name']).toEqual(
          clientAwareness.name,
        );
        expect(headers['apollographql-client-version']).toBeDefined();
        expect(headers['apollographql-client-version']).toEqual(
          clientAwareness.version,
        );

        completions++;

        if (completions === 2) {
          done();
        }
      } catch (error) {
        done.fail(error);
      }
    };

    const error = (error: any) => {
      done.fail(error);
    };

    execute(link, {
      query: sampleQuery,
      context: {
        credentials: 'two',
        clientAwareness,
      },
    }).subscribe(next(data), error, complete);

    execute(link, {
      query: sampleQuery,
      context: { credentials: 'two' },
    }).subscribe(next(data2), error, complete);
  });

  it('errors on an incorrect number of results for a batch', done => {
    const link = new BatchHttpLink({
      uri: '/batch',
      batchInterval: 0,
      batchMax: 3,
    });

    let errors = 0;
    const next = (data: any) => {
      done.fail('next should not have been called');
    };

    const complete = () => {
      done.fail('complete should not have been called');
    };

    const error = (error: any) => {
      errors++;

      if (errors === 3) {
        done();
      }
    };

    execute(link, { query: sampleQuery }).subscribe(next, error, complete);
    execute(link, { query: sampleQuery }).subscribe(next, error, complete);
    execute(link, { query: sampleQuery }).subscribe(next, error, complete);
  });

  describe('batchKey', () => {
    const query = gql`
      query {
        author {
          firstName
          lastName
        }
      }
    `;

    it('should batch queries with different options separately', done => {
      let key = true;
      const batchKey = () => {
        key = !key;
        return '' + !key;
      };

      const link = ApolloLink.from([
        new BatchHttpLink({
          uri: operation => {
            return operation.variables.endpoint;
          },
          batchInterval: 1,
          //if batchKey does not work, then the batch size would be 3
          batchMax: 3,
          batchKey,
        }),
      ]);

      let count = 0;
      const next = (expected: any) => (received: any) => {
        try {
          expect(received).toEqual(expected);
        } catch (e) {
          done.fail(e);
        }
      };
      const complete = () => {
        count++;
        if (count === 4) {
          try {
            const lawlCalls = fetchMock.calls('begin:/lawl');
            expect(lawlCalls.length).toBe(1);
            const roflCalls = fetchMock.calls('begin:/rofl');
            expect(roflCalls.length).toBe(1);
            done();
          } catch (e) {
            done.fail(e);
          }
        }
      };

      [1, 2].forEach(x => {
        execute(link, {
          query,
          variables: { endpoint: '/rofl' },
        }).subscribe({
          next: next(roflData),
          error: done.fail,
          complete,
        });

        execute(link, {
          query,
          variables: { endpoint: '/lawl' },
        }).subscribe({
          next: next(lawlData),
          error: done.fail,
          complete,
        });
      });
    });
  });
});

const convertBatchedBody = (body: any) => {
  const parsed = JSON.parse(body);
  expect(Array.isArray(parsed));
  expect(parsed.length).toBe(1);
  return parsed.pop();
};

const createHttpLink = (httpArgs?: any) => {
  const args = {
    ...httpArgs,
    batchInterval: 0,
    batchMax: 1,
  };
  return new BatchHttpLink(args);
};

describe('SharedHttpTest', () => {
  const data = { data: { hello: 'world' } };
  const data2 = { data: { hello: 'everyone' } };
  const mockError = { throws: new TypeError('mock me') };

  const makePromise = (res: any) =>
    new Promise((resolve, reject) => setTimeout(() => resolve(res)));

  let subscriber: any;

  beforeEach(() => {
    fetchMock.restore();
    fetchMock.post('begin:/data2', makePromise(data2));
    fetchMock.post('begin:/data', makePromise(data));
    fetchMock.post('begin:/error', mockError);
    fetchMock.post('begin:/apollo', makePromise(data));

    fetchMock.get('begin:/data', makePromise(data));
    fetchMock.get('begin:/data2', makePromise(data2));

    const next = jest.fn();
    const error = jest.fn();
    const complete = jest.fn();

    subscriber = {
      next,
      error,
      complete,
    };
  });

  afterEach(() => {
    fetchMock.restore();
  });

  it('raises warning if called with concat', () => {
    const link = createHttpLink();
    const _warn = console.warn;
    console.warn = (warning: any) => expect(warning['message']).toBeDefined();
    expect(link.concat((operation, forward) => forward(operation))).toEqual(
      link,
    );
    console.warn = _warn;
  });

  it('does not need any constructor arguments', () => {
    expect(() => createHttpLink()).not.toThrow();
  });

  it('calls next and then complete', done => {
    const next = jest.fn();
    const link = createHttpLink({ uri: '/data' });
    const observable = execute(link, {
      query: sampleQuery,
    });
    observable.subscribe({
      next,
      error: error => done.fail(error),
      complete: makeCallback(done, () => {
        expect(next).toHaveBeenCalledTimes(1);
      }),
    });
  });

  it('calls error when fetch fails', done => {
    const link = createHttpLink({ uri: '/error' });
    const observable = execute(link, {
      query: sampleQuery,
    });
    observable.subscribe(
      result => done.fail('next should not have been called'),
      makeCallback(done, (error: any) => {
        expect(error).toEqual(mockError.throws);
      }),
      () => done.fail('complete should not have been called'),
    );
  });

  it('calls error when fetch fails', done => {
    const link = createHttpLink({ uri: '/error' });
    const observable = execute(link, {
      query: sampleMutation,
    });
    observable.subscribe(
      result => done.fail('next should not have been called'),
      makeCallback(done, (error: any) => {
        expect(error).toEqual(mockError.throws);
      }),
      () => done.fail('complete should not have been called'),
    );
  });

  it('unsubscribes without calling subscriber', done => {
    const link = createHttpLink({ uri: '/data' });
    const observable = execute(link, {
      query: sampleQuery,
    });
    const subscription = observable.subscribe(
      result => done.fail('next should not have been called'),
      error => done.fail(error),
      () => done.fail('complete should not have been called'),
    );
    subscription.unsubscribe();
    expect(subscription.closed).toBe(true);
    setTimeout(done, 50);
  });

  const verifyRequest = (
    link: ApolloLink,
    after: () => void,
    includeExtensions: boolean,
    done: any,
  ) => {
    const next = jest.fn();
    const context = { info: 'stub' };
    const variables = { params: 'stub' };

    const observable = execute(link, {
      query: sampleMutation,
      context,
      variables,
    });
    observable.subscribe({
      next,
      error: error => done.fail(error),
      complete: () => {
        try {
          let body = convertBatchedBody(fetchMock.lastCall()![1]!.body);
          expect(body.query).toBe(print(sampleMutation));
          expect(body.variables).toEqual(variables);
          expect(body.context).not.toBeDefined();
          if (includeExtensions) {
            expect(body.extensions).toBeDefined();
          } else {
            expect(body.extensions).not.toBeDefined();
          }
          expect(next).toHaveBeenCalledTimes(1);

          after();
        } catch (e) {
          done.fail(e);
        }
      },
    });
  };

  it('passes all arguments to multiple fetch body including extensions', done => {
    const link = createHttpLink({ uri: '/data', includeExtensions: true });
    verifyRequest(
      link,
      () => verifyRequest(link, done, true, done),
      true,
      done,
    );
  });

  it('passes all arguments to multiple fetch body excluding extensions', done => {
    const link = createHttpLink({ uri: '/data' });
    verifyRequest(
      link,
      () => verifyRequest(link, done, false, done),
      false,
      done,
    );
  });

  it('calls multiple subscribers', done => {
    const link = createHttpLink({ uri: '/data' });
    const context = { info: 'stub' };
    const variables = { params: 'stub' };

    const observable = execute(link, {
      query: sampleMutation,
      context,
      variables,
    });
    observable.subscribe(subscriber);
    observable.subscribe(subscriber);

    setTimeout(() => {
      expect(subscriber.next).toHaveBeenCalledTimes(2);
      expect(subscriber.complete).toHaveBeenCalledTimes(2);
      expect(subscriber.error).not.toHaveBeenCalled();
      done();
    }, 50);
  });

  it('calls remaining subscribers after unsubscribe', done => {
    const link = createHttpLink({ uri: '/data' });
    const context = { info: 'stub' };
    const variables = { params: 'stub' };

    const observable = execute(link, {
      query: sampleMutation,
      context,
      variables,
    });

    observable.subscribe(subscriber);

    setTimeout(() => {
      const subscription = observable.subscribe(subscriber);
      subscription.unsubscribe();
    }, 10);

    setTimeout(
      makeCallback(done, () => {
        expect(subscriber.next).toHaveBeenCalledTimes(1);
        expect(subscriber.complete).toHaveBeenCalledTimes(1);
        expect(subscriber.error).not.toHaveBeenCalled();
        done();
      }),
      50,
    );
  });

  it('allows for dynamic endpoint setting', done => {
    const variables = { params: 'stub' };
    const link = createHttpLink({ uri: '/data' });

    execute(link, {
      query: sampleQuery,
      variables,
      context: { uri: '/data2' },
    }).subscribe(result => {
      expect(result).toEqual(data2);
      done();
    });
  });

  it('adds headers to the request from the context', done => {
    const variables = { params: 'stub' };
    const middleware = new ApolloLink((operation, forward) => {
      operation.setContext({
        headers: { authorization: '1234' },
      });
      return forward(operation).map(result => {
        const { headers } = operation.getContext();
        try {
          expect(headers).toBeDefined();
        } catch (e) {
          done.fail(e);
        }
        return result;
      });
    });
    const link = middleware.concat(createHttpLink({ uri: '/data' }));

    execute(link, { query: sampleQuery, variables }).subscribe(
      makeCallback(done, (result: any) => {
        const headers: any = fetchMock.lastCall()![1]!.headers;
        expect(headers.authorization).toBe('1234');
        expect(headers['content-type']).toBe('application/json');
        expect(headers.accept).toBe('*/*');
      }),
    );
  });

  it('adds headers to the request from the setup', done => {
    const variables = { params: 'stub' };
    const link = createHttpLink({
      uri: '/data',
      headers: { authorization: '1234' },
    });

    execute(link, { query: sampleQuery, variables }).subscribe(
      makeCallback(done, (result: any) => {
        const headers: any = fetchMock.lastCall()![1]!.headers;
        expect(headers.authorization).toBe('1234');
        expect(headers['content-type']).toBe('application/json');
        expect(headers.accept).toBe('*/*');
      }),
    );
  });

  it('prioritizes context headers over setup headers', done => {
    const variables = { params: 'stub' };
    const middleware = new ApolloLink((operation, forward) => {
      operation.setContext({
        headers: { authorization: '1234' },
      });
      return forward(operation);
    });
    const link = middleware.concat(
      createHttpLink({ uri: '/data', headers: { authorization: 'no user' } }),
    );

    execute(link, { query: sampleQuery, variables }).subscribe(
      makeCallback(done, (result: any) => {
        const headers: any = fetchMock.lastCall()![1]!.headers;
        expect(headers.authorization).toBe('1234');
        expect(headers['content-type']).toBe('application/json');
        expect(headers.accept).toBe('*/*');
      }),
    );
  });

  it('adds headers to the request from the context on an operation', done => {
    const variables = { params: 'stub' };
    const link = createHttpLink({ uri: '/data' });

    const context = {
      headers: { authorization: '1234' },
    };
    execute(link, {
      query: sampleQuery,
      variables,
      context,
    }).subscribe(
      makeCallback(done, (result: any) => {
        const headers: any = fetchMock.lastCall()![1]!.headers;
        expect(headers.authorization).toBe('1234');
        expect(headers['content-type']).toBe('application/json');
        expect(headers.accept).toBe('*/*');
      }),
    );
  });

  it('adds creds to the request from the context', done => {
    const variables = { params: 'stub' };
    const middleware = new ApolloLink((operation, forward) => {
      operation.setContext({
        credentials: 'same-team-yo',
      });
      return forward(operation);
    });
    const link = middleware.concat(createHttpLink({ uri: '/data' }));

    execute(link, { query: sampleQuery, variables }).subscribe(
      makeCallback(done, (result: any) => {
        const creds = fetchMock.lastCall()![1]!.credentials;
        expect(creds).toBe('same-team-yo');
      }),
    );
  });

  it('adds creds to the request from the setup', done => {
    const variables = { params: 'stub' };
    const link = createHttpLink({ uri: '/data', credentials: 'same-team-yo' });

    execute(link, { query: sampleQuery, variables }).subscribe(
      makeCallback(done, (result: any) => {
        const creds = fetchMock.lastCall()![1]!.credentials;
        expect(creds).toBe('same-team-yo');
      }),
    );
  });

  it('prioritizes creds from the context over the setup', done => {
    const variables = { params: 'stub' };
    const middleware = new ApolloLink((operation, forward) => {
      operation.setContext({
        credentials: 'same-team-yo',
      });
      return forward(operation);
    });
    const link = middleware.concat(
      createHttpLink({ uri: '/data', credentials: 'error' }),
    );

    execute(link, { query: sampleQuery, variables }).subscribe(
      makeCallback(done, (result: any) => {
        const creds = fetchMock.lastCall()![1]!.credentials;
        expect(creds).toBe('same-team-yo');
      }),
    );
  });

  it('adds uri to the request from the context', done => {
    const variables = { params: 'stub' };
    const middleware = new ApolloLink((operation, forward) => {
      operation.setContext({
        uri: '/data',
      });
      return forward(operation);
    });
    const link = middleware.concat(createHttpLink());

    execute(link, { query: sampleQuery, variables }).subscribe(
      makeCallback(done, (result: any) => {
        const uri = fetchMock.lastUrl();
        expect(uri).toBe('/data');
      }),
    );
  });

  it('adds uri to the request from the setup', done => {
    const variables = { params: 'stub' };
    const link = createHttpLink({ uri: '/data' });

    execute(link, { query: sampleQuery, variables }).subscribe(
      makeCallback(done, (result: any) => {
        const uri = fetchMock.lastUrl();
        expect(uri).toBe('/data');
      }),
    );
  });

  it('prioritizes context uri over setup uri', done => {
    const variables = { params: 'stub' };
    const middleware = new ApolloLink((operation, forward) => {
      operation.setContext({
        uri: '/apollo',
      });
      return forward(operation);
    });
    const link = middleware.concat(
      createHttpLink({ uri: '/data', credentials: 'error' }),
    );

    execute(link, { query: sampleQuery, variables }).subscribe(
      makeCallback(done, (result: any) => {
        const uri = fetchMock.lastUrl();

        expect(uri).toBe('/apollo');
      }),
    );
  });

  it('allows uri to be a function', done => {
    const variables = { params: 'stub' };
    const customFetch = (_uri: any, options: any) => {
      const { operationName } = convertBatchedBody(options.body);
      try {
        expect(operationName).toBe('SampleQuery');
      } catch (e) {
        done.fail(e);
      }
      return fetch('/dataFunc', options);
    };

    const link = createHttpLink({ fetch: customFetch });

    execute(link, { query: sampleQuery, variables }).subscribe(
      makeCallback(done, (result: any) => {
        expect(fetchMock.lastUrl()).toBe('/dataFunc');
      }),
    );
  });

  it('adds fetchOptions to the request from the setup', done => {
    const variables = { params: 'stub' };
    const link = createHttpLink({
      uri: '/data',
      fetchOptions: { someOption: 'foo', mode: 'no-cors' },
    });

    execute(link, { query: sampleQuery, variables }).subscribe(
      makeCallback(done, (result: any) => {
        const { someOption, mode, headers } = fetchMock.lastCall()![1]! as any;
        expect(someOption).toBe('foo');
        expect(mode).toBe('no-cors');
        expect(headers['content-type']).toBe('application/json');
      }),
    );
  });

  it('adds fetchOptions to the request from the context', done => {
    const variables = { params: 'stub' };
    const middleware = new ApolloLink((operation, forward) => {
      operation.setContext({
        fetchOptions: {
          someOption: 'foo',
        },
      });
      return forward(operation);
    });
    const link = middleware.concat(createHttpLink({ uri: '/data' }));

    execute(link, { query: sampleQuery, variables }).subscribe(
      makeCallback(done, (result: any) => {
        const { someOption } = fetchMock.lastCall()![1]! as any;
        expect(someOption).toBe('foo');
        done();
      }),
    );
  });

  it('prioritizes context over setup', done => {
    const variables = { params: 'stub' };
    const middleware = new ApolloLink((operation, forward) => {
      operation.setContext({
        fetchOptions: {
          someOption: 'foo',
        },
      });
      return forward(operation);
    });
    const link = middleware.concat(
      createHttpLink({ uri: '/data', fetchOptions: { someOption: 'bar' } }),
    );

    execute(link, { query: sampleQuery, variables }).subscribe(
      makeCallback(done, (result: any) => {
        const { someOption } = fetchMock.lastCall()![1]! as any;
        expect(someOption).toBe('foo');
      }),
    );
  });

  it('allows for not sending the query with the request', done => {
    const variables = { params: 'stub' };
    const middleware = new ApolloLink((operation, forward) => {
      operation.setContext({
        http: {
          includeQuery: false,
          includeExtensions: true,
        },
      });
      operation.extensions.persistedQuery = { hash: '1234' };
      return forward(operation);
    });
    const link = middleware.concat(createHttpLink({ uri: '/data' }));

    execute(link, { query: sampleQuery, variables }).subscribe(
      makeCallback(done, (result: any) => {
        let body = convertBatchedBody(fetchMock.lastCall()![1]!.body);

        expect(body.query).not.toBeDefined();
        expect(body.extensions).toEqual({ persistedQuery: { hash: '1234' } });
        done();
      }),
    );
  });

  it('sets the raw response on context', done => {
    const middleware = new ApolloLink((operation, forward) => {
      return new Observable(ob => {
        const op = forward(operation);
        const sub = op.subscribe({
          next: ob.next.bind(ob),
          error: ob.error.bind(ob),
          complete: makeCallback(done, (e: any) => {
            expect(operation.getContext().response.headers.toBeDefined);
            ob.complete();
          }),
        });

        return () => {
          sub.unsubscribe();
        };
      });
    });

    const link = middleware.concat(createHttpLink({ uri: '/data', fetch }));

    execute(link, { query: sampleQuery }).subscribe(
      result => {
        done();
      },
      () => {},
    );
  });
});
