import gql from 'graphql-tag';

import { ApolloLink } from '../../core';
import { Observable } from '../../../utilities/observables/Observable';
import { execute } from '../../core/execute';
import { setContext } from '../index';

const sleep = (ms: number) => new Promise(s => setTimeout(s, ms));
const query = gql`
  query Test {
    foo {
      bar
    }
  }
`;
const data = {
  foo: { bar: true },
};

it('can be used to set the context with a simple function', done => {
  const withContext = setContext(() => ({ dynamicallySet: true }));

  const mockLink = new ApolloLink(operation => {
    expect(operation.getContext().dynamicallySet).toBe(true);
    return Observable.of({ data });
  });

  const link = withContext.concat(mockLink);

  execute(link, { query }).subscribe(result => {
    expect(result.data).toEqual(data);
    done();
  });
});

it('can be used to set the context with a function returning a promise', done => {
  const withContext = setContext(() =>
    Promise.resolve({ dynamicallySet: true }),
  );

  const mockLink = new ApolloLink(operation => {
    expect(operation.getContext().dynamicallySet).toBe(true);
    return Observable.of({ data });
  });

  const link = withContext.concat(mockLink);

  execute(link, { query }).subscribe(result => {
    expect(result.data).toEqual(data);
    done();
  });
});

it('can be used to set the context with a function returning a promise that is delayed', done => {
  const withContext = setContext(() =>
    sleep(25).then(() => ({ dynamicallySet: true })),
  );

  const mockLink = new ApolloLink(operation => {
    expect(operation.getContext().dynamicallySet).toBe(true);
    return Observable.of({ data });
  });

  const link = withContext.concat(mockLink);

  execute(link, { query }).subscribe(result => {
    expect(result.data).toEqual(data);
    done();
  });
});

it('handles errors in the lookup correclty', done => {
  const withContext = setContext(() =>
    sleep(5).then(() => {
      throw new Error('dang');
    }),
  );

  const mockLink = new ApolloLink(operation => {
    return Observable.of({ data });
  });

  const link = withContext.concat(mockLink);

  execute(link, { query }).subscribe(done.fail as any, e => {
    expect(e.message).toBe('dang');
    done();
  });
});
it('handles errors in the lookup correclty with a normal function', done => {
  const withContext = setContext(() => {
    throw new Error('dang');
  });

  const mockLink = new ApolloLink(operation => {
    return Observable.of({ data });
  });

  const link = withContext.concat(mockLink);

  execute(link, { query }).subscribe(done.fail as any, e => {
    expect(e.message).toBe('dang');
    done();
  });
});

it('has access to the request information', done => {
  const withContext = setContext(({ operationName, query, variables }) =>
    sleep(1).then(() =>
      Promise.resolve({
        variables: variables ? true : false,
        operation: query ? true : false,
        operationName: operationName!.toUpperCase(),
      }),
    ),
  );

  const mockLink = new ApolloLink(op => {
    const { variables, operation, operationName } = op.getContext();
    expect(variables).toBe(true);
    expect(operation).toBe(true);
    expect(operationName).toBe('TEST');
    return Observable.of({ data });
  });

  const link = withContext.concat(mockLink);

  execute(link, { query, variables: { id: 1 } }).subscribe(result => {
    expect(result.data).toEqual(data);
    done();
  });
});
it('has access to the context at execution time', done => {
  const withContext = setContext((_, { count }) =>
    sleep(1).then(() => ({ count: count + 1 })),
  );

  const mockLink = new ApolloLink(operation => {
    const { count } = operation.getContext();
    expect(count).toEqual(2);
    return Observable.of({ data });
  });

  const link = withContext.concat(mockLink);

  execute(link, { query, context: { count: 1 } }).subscribe(result => {
    expect(result.data).toEqual(data);
    done();
  });
});

it('unsubscribes correctly', done => {
  const withContext = setContext((_, { count }) =>
    sleep(1).then(() => ({ count: count + 1 })),
  );

  const mockLink = new ApolloLink(operation => {
    const { count } = operation.getContext();
    expect(count).toEqual(2);
    return Observable.of({ data });
  });

  const link = withContext.concat(mockLink);

  let handle = execute(link, {
    query,
    context: { count: 1 },
  }).subscribe(result => {
    expect(result.data).toEqual(data);
    handle.unsubscribe();
    done();
  });
});

it('unsubscribes without throwing before data', done => {
  let called: boolean;
  const withContext = setContext((_, { count }) => {
    called = true;
    return sleep(1).then(() => ({ count: count + 1 }));
  });

  const mockLink = new ApolloLink(operation => {
    const { count } = operation.getContext();
    expect(count).toEqual(2);
    return new Observable(obs => {
      setTimeout(() => {
        obs.next({ data });
        obs.complete();
      }, 25);
    });
  });

  const link = withContext.concat(mockLink);

  let handle = execute(link, {
    query,
    context: { count: 1 },
  }).subscribe(result => {
    done.fail('should have unsubscribed');
  });

  setTimeout(() => {
    handle.unsubscribe();
    expect(called).toBe(true);
    done();
  }, 10);
});

it('does not start the next link subscription if the upstream subscription is already closed', done => {
  let promiseResolved = false;
  const withContext = setContext(() =>
    sleep(5).then(() => {
      promiseResolved = true;
      return { dynamicallySet: true }
    }),
  );

  let mockLinkCalled = false;
  const mockLink = new ApolloLink(operation => {
    mockLinkCalled = true;
    fail('link should not be called');
  });

  const link = withContext.concat(mockLink);

  let subscriptionReturnedData = false;
  let handle = execute(link, { query }).subscribe(result => {
    subscriptionReturnedData = true;
    fail('subscription should not return data');
  });

  handle.unsubscribe();

  setTimeout(() => {
    expect(promiseResolved).toBe(true);
    expect(mockLinkCalled).toBe(false);
    expect(subscriptionReturnedData).toBe(false);
    done();
  }, 10);
});
