import gql from 'graphql-tag';
import { print } from 'graphql/language/printer';

import { Observable } from '../../../utilities/observables/Observable';
import type { FetchResult, Operation, NextLink, GraphQLRequest } from '../types';
import { ApolloLink } from '../ApolloLink';
import type { DocumentNode } from 'graphql';

export class SetContextLink extends ApolloLink {
  constructor(
    private setContext: (
      context: Record<string, any>,
    ) => Record<string, any> = c => c,
  ) {
    super();
  }

  public request(
    operation: Operation,
    forward: NextLink,
  ): Observable<FetchResult> {
    operation.setContext(this.setContext(operation.getContext()));
    return forward(operation);
  }
}

export const sampleQuery = gql`
  query SampleQuery {
    stub {
      id
    }
  }
`;

function checkCalls<T>(calls: any[] = [], results: Array<T>) {
  expect(calls.length).toBe(results.length);
  calls.map((call, i) => expect(call.data).toEqual(results[i]));
}

interface TestResultType {
  link: ApolloLink;
  results?: any[];
  query?: DocumentNode;
  done?: () => void;
  context?: any;
  variables?: any;
}

export function testLinkResults(params: TestResultType) {
  const { link, context, variables } = params;
  const results = params.results || [];
  const query = params.query || sampleQuery;
  const done = params.done || (() => void 0);

  const spy = jest.fn();
  ApolloLink.execute(link, { query, context, variables }).subscribe({
    next: spy,
    error: (error: any) => {
      expect(error).toEqual(results.pop());
      checkCalls(spy.mock.calls[0], results);
      if (done) {
        done();
      }
    },
    complete: () => {
      checkCalls(spy.mock.calls[0], results);
      if (done) {
        done();
      }
    },
  });
}

export const setContext = () => ({ add: 1 });

describe('ApolloClient', () => {
  describe('context', () => {
    it('should merge context when using a function', done => {
      const returnOne = new SetContextLink(setContext);
      const mock = new ApolloLink((op, forward) => {
        op.setContext((context: { add: number; }) => ({ add: context.add + 2 }));
        op.setContext(() => ({ substract: 1 }));

        return forward(op);
      });
      const link = returnOne.concat(mock).concat(op => {
        expect(op.getContext()).toEqual({
          add: 3,
          substract: 1,
        });
        return Observable.of({ data: op.getContext().add });
      });

      testLinkResults({
        link,
        results: [3],
        done,
      });
    });

    it('should merge context when not using a function', done => {
      const returnOne = new SetContextLink(setContext);
      const mock = new ApolloLink((op, forward) => {
        op.setContext({ add: 3 });
        op.setContext({ substract: 1 });

        return forward(op);
      });
      const link = returnOne.concat(mock).concat(op => {
        expect(op.getContext()).toEqual({
          add: 3,
          substract: 1,
        });
        return Observable.of({ data: op.getContext().add });
      });

      testLinkResults({
        link,
        results: [3],
        done,
      });
    });
  });

  describe('concat', () => {
    it('should concat a function', done => {
      const returnOne = new SetContextLink(setContext);
      const link = returnOne.concat((operation, forward) => {
        return Observable.of({ data: { count: operation.getContext().add } });
      });

      testLinkResults({
        link,
        results: [{ count: 1 }],
        done,
      });
    });

    it('should concat a Link', done => {
      const returnOne = new SetContextLink(setContext);
      const mock = new ApolloLink(op =>
        Observable.of({ data: op.getContext().add }),
      );
      const link = returnOne.concat(mock);

      testLinkResults({
        link,
        results: [1],
        done,
      });
    });

    it("should pass error to observable's error", done => {
      const error = new Error('thrown');
      const returnOne = new SetContextLink(setContext);
      const mock = new ApolloLink(
        op =>
          new Observable(observer => {
            observer.next({ data: op.getContext().add });
            observer.error(error);
          }),
      );
      const link = returnOne.concat(mock);

      testLinkResults({
        link,
        results: [1, error],
        done,
      });
    });

    it('should concat a Link and function', done => {
      const returnOne = new SetContextLink(setContext);
      const mock = new ApolloLink((op, forward) => {
        op.setContext((context: { add: number; }) => ({ add: context.add + 2 }));
        return forward(op);
      });
      const link = returnOne.concat(mock).concat(op => {
        return Observable.of({ data: op.getContext().add });
      });

      testLinkResults({
        link,
        results: [3],
        done,
      });
    });

    it('should concat a function and Link', done => {
      const returnOne = new SetContextLink(setContext);
      const mock = new ApolloLink((op, forward) =>
        Observable.of({ data: op.getContext().add }),
      );

      const link = returnOne
        .concat((operation, forward) => {
          operation.setContext({
            add: operation.getContext().add + 2,
          });
          return forward(operation);
        })
        .concat(mock);
      testLinkResults({
        link,
        results: [3],
        done,
      });
    });

    it('should concat two functions', done => {
      const returnOne = new SetContextLink(setContext);
      const link = returnOne
        .concat((operation, forward) => {
          operation.setContext({
            add: operation.getContext().add + 2,
          });
          return forward(operation);
        })
        .concat((op, forward) => Observable.of({ data: op.getContext().add }));
      testLinkResults({
        link,
        results: [3],
        done,
      });
    });

    it('should concat two Links', done => {
      const returnOne = new SetContextLink(setContext);
      const mock1 = new ApolloLink((operation, forward) => {
        operation.setContext({
          add: operation.getContext().add + 2,
        });
        return forward(operation);
      });
      const mock2 = new ApolloLink((op, forward) =>
        Observable.of({ data: op.getContext().add }),
      );

      const link = returnOne.concat(mock1).concat(mock2);
      testLinkResults({
        link,
        results: [3],
        done,
      });
    });

    it("should return an link that can be concat'd multiple times", done => {
      const returnOne = new SetContextLink(setContext);
      const mock1 = new ApolloLink((operation, forward) => {
        operation.setContext({
          add: operation.getContext().add + 2,
        });
        return forward(operation);
      });
      const mock2 = new ApolloLink((op, forward) =>
        Observable.of({ data: op.getContext().add + 2 }),
      );
      const mock3 = new ApolloLink((op, forward) =>
        Observable.of({ data: op.getContext().add + 3 }),
      );
      const link = returnOne.concat(mock1);

      testLinkResults({
        link: link.concat(mock2),
        results: [5],
      });
      testLinkResults({
        link: link.concat(mock3),
        results: [6],
        done,
      });
    });
  });

  describe('empty', () => {
    it('should returns an immediately completed Observable', done => {
      testLinkResults({
        link: ApolloLink.empty(),
        done,
      });
    });
  });

  describe('execute', () => {
    it('transforms an opearation with context into something serlizable', done => {
      const query = gql`
        {
          id
        }
      `;
      const link = new ApolloLink(operation => {
        const str = JSON.stringify({
          ...operation,
          query: print(operation.query),
        });

        expect(str).toBe(
          JSON.stringify({
            variables: { id: 1 },
            extensions: { cache: true },
            query: print(operation.query),
          }),
        );
        return Observable.of();
      });
      const noop = () => {};
      ApolloLink.execute(link, {
        query,
        variables: { id: 1 },
        extensions: { cache: true },
      }).subscribe(noop, noop, done);
    });

    describe('execute', () => {
      let _warn: (message?: any, ...originalParams: any[]) => void;

      beforeEach(() => {
        _warn = console.warn;
        console.warn = jest.fn(warning => {
          expect(warning).toBe(`query should either be a string or GraphQL AST`);
        });
      });

      afterEach(() => {
        console.warn = _warn;
      });

      it('should return an empty observable when a link returns null', done => {
        const link = new ApolloLink();
        link.request = () => null;
        testLinkResults({
          link,
          results: [],
          done,
        });
      });

      it('should return an empty observable when a link is empty', done => {
        testLinkResults({
          link: ApolloLink.empty(),
          results: [],
          done,
        });
      });

      it("should return an empty observable when a concat'd link returns null", done => {
        const link = new ApolloLink((operation, forward) => {
          return forward(operation);
        }).concat(() => null);
        testLinkResults({
          link,
          results: [],
          done,
        });
      });

      it('should return an empty observable when a split link returns null', done => {
        let context = { test: true };
        const link = new SetContextLink(() => context).split(
          op => op.getContext().test,
          () => Observable.of(),
          () => null,
        );
        testLinkResults({
          link,
          results: [],
        });
        context.test = false;
        testLinkResults({
          link,
          results: [],
          done,
        });
      });

      it('should set a default context, variable, and query on a copy of operation', done => {
        const operation = {
          query: gql`
            {
              id
            }
          `,
        };
        const link = new ApolloLink((op: Operation) => {
          expect((operation as any)['operationName']).toBeUndefined();
          expect((operation as any)['variables']).toBeUndefined();
          expect((operation as any)['context']).toBeUndefined();
          expect((operation as any)['extensions']).toBeUndefined();
          expect(op['variables']).toBeDefined();
          expect((op as any)['context']).toBeUndefined();
          expect(op['extensions']).toBeDefined();
          return Observable.of();
        });

        ApolloLink.execute(link, operation).subscribe({
          complete: done,
        });
      });
    })
  });

  describe('from', () => {
    const uniqueOperation: GraphQLRequest = {
      query: sampleQuery,
      context: { name: 'uniqueName' },
      operationName: 'SampleQuery',
      extensions: {},
    };

    it('should create an observable that completes when passed an empty array', done => {
      const observable = ApolloLink.execute(ApolloLink.from([]), {
        query: sampleQuery,
      });
      observable.subscribe(() => expect(false), () => expect(false), done);
    });

    it('can create chain of one', () => {
      expect(() => ApolloLink.from([new ApolloLink()])).not.toThrow();
    });

    it('can create chain of two', () => {
      expect(() =>
        ApolloLink.from([
          new ApolloLink((operation, forward) => forward(operation)),
          new ApolloLink(),
        ]),
      ).not.toThrow();
    });

    it('should receive result of one link', done => {
      const data: FetchResult = {
        data: {
          hello: 'world',
        },
      };
      const chain = ApolloLink.from([new ApolloLink(() => Observable.of(data))]);
      // Smoke tests execute as a static method
      const observable = ApolloLink.execute(chain, uniqueOperation);
      observable.subscribe({
        next: actualData => {
          expect(data).toEqual(actualData);
        },
        error: () => {
          throw new Error();
        },
        complete: () => done(),
      });
    });

    it('should accept AST query and pass AST to link', () => {
      const astOperation = {
        ...uniqueOperation,
        query: sampleQuery,
      };

      const stub = jest.fn();

      const chain = ApolloLink.from([new ApolloLink(stub)]);
      ApolloLink.execute(chain, astOperation);

      expect(stub).toBeCalledWith({
        query: sampleQuery,
        operationName: 'SampleQuery',
        variables: {},
        extensions: {},
      });
    });

    it('should pass operation from one link to next with modifications', done => {
      const chain = ApolloLink.from([
        new ApolloLink((op, forward) =>
          forward({
            ...op,
            query: sampleQuery,
          }),
        ),
        new ApolloLink(op => {
          expect({
            extensions: {},
            operationName: 'SampleQuery',
            query: sampleQuery,
            variables: {},
          }).toEqual(op);
          return done();
        }),
      ]);
      ApolloLink.execute(chain, uniqueOperation);
    });

    it('should pass result of one link to another with forward', done => {
      const data: FetchResult = {
        data: {
          hello: 'world',
        },
      };

      const chain = ApolloLink.from([
        new ApolloLink((op, forward) => {
          const observable = forward(op);

          observable.subscribe({
            next: actualData => {
              expect(data).toEqual(actualData);
            },
            error: () => {
              throw new Error();
            },
            complete: done,
          });

          return observable;
        }),
        new ApolloLink(() => Observable.of(data)),
      ]);
      ApolloLink.execute(chain, uniqueOperation);
    });

    it('should receive final result of two link chain', done => {
      const data: FetchResult = {
        data: {
          hello: 'world',
        },
      };

      const chain = ApolloLink.from([
        new ApolloLink((op, forward) => {
          const observable = forward(op);

          return new Observable(observer => {
            observable.subscribe({
              next: actualData => {
                expect(data).toEqual(actualData);
                observer.next({
                  data: {
                    ...actualData.data,
                    modification: 'unique',
                  },
                });
              },
              error: error => observer.error(error),
              complete: () => observer.complete(),
            });
          });
        }),
        new ApolloLink(() => Observable.of(data)),
      ]);

      const result = ApolloLink.execute(chain, uniqueOperation);

      result.subscribe({
        next: modifiedData => {
          expect({
            data: {
              ...data.data,
              modification: 'unique',
            },
          }).toEqual(modifiedData);
        },
        error: () => {
          throw new Error();
        },
        complete: done,
      });
    });

    it('should chain together a function with links', done => {
      const add1 = new ApolloLink((operation: Operation, forward: NextLink) => {
        operation.setContext((context: { num: number; }) => ({ num: context.num + 1 }));
        return forward(operation);
      });
      const add1Link = new ApolloLink((operation, forward) => {
        operation.setContext((context: { num: number; }) => ({ num: context.num + 1 }));
        return forward(operation);
      });

      const link = ApolloLink.from([
        add1,
        add1,
        add1Link,
        add1,
        add1Link,
        new ApolloLink(operation =>
          Observable.of({ data: operation.getContext() }),
        ),
      ]);
      testLinkResults({
        link,
        results: [{ num: 5 }],
        context: { num: 0 },
        done,
      });
    });
  });

  describe('split', () => {
    it('should split two functions', done => {
      const context = { add: 1 };
      const returnOne = new SetContextLink(() => context);
      const link1 = returnOne.concat((operation, forward) =>
        Observable.of({ data: operation.getContext().add + 1 }),
      );
      const link2 = returnOne.concat((operation, forward) =>
        Observable.of({ data: operation.getContext().add + 2 }),
      );
      const link = returnOne.split(
        operation => operation.getContext().add === 1,
        link1,
        link2,
      );

      testLinkResults({
        link,
        results: [2],
      });

      context.add = 2;

      testLinkResults({
        link,
        results: [4],
        done,
      });
    });

    it('should split two Links', done => {
      const context = { add: 1 };
      const returnOne = new SetContextLink(() => context);
      const link1 = returnOne.concat(
        new ApolloLink((operation, forward) =>
          Observable.of({ data: operation.getContext().add + 1 }),
        ),
      );
      const link2 = returnOne.concat(
        new ApolloLink((operation, forward) =>
          Observable.of({ data: operation.getContext().add + 2 }),
        ),
      );
      const link = returnOne.split(
        operation => operation.getContext().add === 1,
        link1,
        link2,
      );

      testLinkResults({
        link,
        results: [2],
      });

      context.add = 2;

      testLinkResults({
        link,
        results: [4],
        done,
      });
    });

    it('should split a link and a function', done => {
      const context = { add: 1 };
      const returnOne = new SetContextLink(() => context);
      const link1 = returnOne.concat((operation, forward) =>
        Observable.of({ data: operation.getContext().add + 1 }),
      );
      const link2 = returnOne.concat(
        new ApolloLink((operation, forward) =>
          Observable.of({ data: operation.getContext().add + 2 }),
        ),
      );
      const link = returnOne.split(
        operation => operation.getContext().add === 1,
        link1,
        link2,
      );

      testLinkResults({
        link,
        results: [2],
      });

      context.add = 2;

      testLinkResults({
        link,
        results: [4],
        done,
      });
    });

    it('should allow concat after split to be join', done => {
      const context = { test: true, add: 1 };
      const start = new SetContextLink(() => ({ ...context }));
      const link = start
        .split(
          operation => operation.getContext().test,
          (operation, forward) => {
            operation.setContext((context: { add: number; }) => ({ add: context.add + 1 }));
            return forward(operation);
          },
          (operation, forward) => {
            operation.setContext((context: { add: number; }) => ({ add: context.add + 2 }));
            return forward(operation);
          },
        )
        .concat(operation =>
          Observable.of({ data: operation.getContext().add }),
        );

      testLinkResults({
        link,
        context,
        results: [2],
      });

      context.test = false;

      testLinkResults({
        link,
        context,
        results: [3],
        done,
      });
    });

    it('should allow default right to be empty or passthrough when forward available', done => {
      let context = { test: true };
      const start = new SetContextLink(() => context);
      const link = start.split(
        operation => operation.getContext().test,
        operation =>
          Observable.of({
            data: {
              count: 1,
            },
          }),
      );
      const concat = link.concat(operation =>
        Observable.of({
          data: {
            count: 2,
          },
        }),
      );

      testLinkResults({
        link,
        results: [{ count: 1 }],
      });

      context.test = false;

      testLinkResults({
        link,
        results: [],
      });

      testLinkResults({
        link: concat,
        results: [{ count: 2 }],
        done,
      });
    });

    it('should create filter when single link passed in', done => {
      const link = ApolloLink.split(
        operation => operation.getContext().test,
        (operation, forward) => Observable.of({ data: { count: 1 } }),
      );

      let context = { test: true };

      testLinkResults({
        link,
        results: [{ count: 1 }],
        context,
      });

      context.test = false;

      testLinkResults({
        link,
        results: [],
        context,
        done,
      });
    });

    it('should split two functions', done => {
      const link = ApolloLink.split(
        operation => operation.getContext().test,
        (operation, forward) => Observable.of({ data: { count: 1 } }),
        (operation, forward) => Observable.of({ data: { count: 2 } }),
      );

      let context = { test: true };

      testLinkResults({
        link,
        results: [{ count: 1 }],
        context,
      });

      context.test = false;

      testLinkResults({
        link,
        results: [{ count: 2 }],
        context,
        done,
      });
    });

    it('should split two Links', done => {
      const link = ApolloLink.split(
        operation => operation.getContext().test,
        (operation, forward) => Observable.of({ data: { count: 1 } }),
        new ApolloLink((operation, forward) =>
          Observable.of({ data: { count: 2 } }),
        ),
      );

      let context = { test: true };

      testLinkResults({
        link,
        results: [{ count: 1 }],
        context,
      });

      context.test = false;

      testLinkResults({
        link,
        results: [{ count: 2 }],
        context,
        done,
      });
    });

    it('should split a link and a function', done => {
      const link = ApolloLink.split(
        operation => operation.getContext().test,
        (operation, forward) => Observable.of({ data: { count: 1 } }),
        new ApolloLink((operation, forward) =>
          Observable.of({ data: { count: 2 } }),
        ),
      );

      let context = { test: true };

      testLinkResults({
        link,
        results: [{ count: 1 }],
        context,
      });

      context.test = false;

      testLinkResults({
        link,
        results: [{ count: 2 }],
        context,
        done,
      });
    });

    it('should allow concat after split to be join', done => {
      const context = { test: true };
      const link = ApolloLink.split(
        operation => operation.getContext().test,
        (operation, forward) =>
          forward(operation).map(data => ({
            data: { count: data.data!.count + 1 },
          })),
      ).concat(() => Observable.of({ data: { count: 1 } }));

      testLinkResults({
        link,
        context,
        results: [{ count: 2 }],
      });

      context.test = false;

      testLinkResults({
        link,
        context,
        results: [{ count: 1 }],
        done,
      });
    });

    it('should allow default right to be passthrough', done => {
      const context = { test: true };
      const link = ApolloLink.split(
        operation => operation.getContext().test,
        operation => Observable.of({ data: { count: 2 } }),
      ).concat(operation => Observable.of({ data: { count: 1 } }));

      testLinkResults({
        link,
        context,
        results: [{ count: 2 }],
      });

      context.test = false;

      testLinkResults({
        link,
        context,
        results: [{ count: 1 }],
        done,
      });
    });
  });

  describe('Terminating links', () => {
    const _warn = console.warn;
    const warningStub = jest.fn(warning => {
      expect(warning.message).toBe(
        `You are calling concat on a terminating link, which will have no effect`,
      );
    });
    const data = {
      stub: 'data',
    };

    beforeAll(() => {
      console.warn = warningStub;
    });

    beforeEach(() => {
      warningStub.mockClear();
    });

    afterAll(() => {
      console.warn = _warn;
    });

    describe('split', () => {
      it('should not warn if attempting to split a terminating and non-terminating Link', () => {
        const split = ApolloLink.split(
          () => true,
          operation => Observable.of({ data }),
          (operation, forward) => forward(operation),
        );
        split.concat((operation, forward) => forward(operation));
        expect(warningStub).not.toBeCalled();
      });

      it('should warn if attempting to concat to split two terminating links', () => {
        const split = ApolloLink.split(
          () => true,
          operation => Observable.of({ data }),
          operation => Observable.of({ data }),
        );
        expect(split.concat((operation, forward) => forward(operation))).toEqual(
          split,
        );
        expect(warningStub).toHaveBeenCalledTimes(1);
      });

      it('should warn if attempting to split to split two terminating links', () => {
        const split = ApolloLink.split(
          () => true,
          operation => Observable.of({ data }),
          operation => Observable.of({ data }),
        );
        expect(
          split.split(
            () => true,
            (operation, forward) => forward(operation),
            (operation, forward) => forward(operation),
          ),
        ).toEqual(split);
        expect(warningStub).toHaveBeenCalledTimes(1);
      });
    });

    describe('from', () => {
      it('should not warn if attempting to form a terminating then non-terminating Link', () => {
        ApolloLink.from([
          (operation, forward) => forward(operation),
          operation => Observable.of({ data }),
        ]);
        expect(warningStub).not.toBeCalled();
      });

      it('should warn if attempting to add link after termination', () => {
        ApolloLink.from([
          (operation, forward) => forward(operation),
          operation => Observable.of({ data }),
          (operation, forward) => forward(operation),
        ]);
        expect(warningStub).toHaveBeenCalledTimes(1);
      });

      it('should warn if attempting to add link after termination', () => {
        ApolloLink.from([
          new ApolloLink((operation, forward) => forward(operation)),
          new ApolloLink(operation => Observable.of({ data })),
          new ApolloLink((operation, forward) => forward(operation)),
        ]);
        expect(warningStub).toHaveBeenCalledTimes(1);
      });
    });

    describe('concat', () => {
      it('should warn if attempting to concat to a terminating Link from function', () => {
        const link = new ApolloLink(operation => Observable.of({ data }));
        expect(ApolloLink.concat(link, (operation, forward) => forward(operation))).toEqual(
          link,
        );
        expect(warningStub).toHaveBeenCalledTimes(1);
        expect(warningStub.mock.calls[0][0].link).toEqual(link);
      });

      it('should warn if attempting to concat to a terminating Link', () => {
        const link = new ApolloLink(operation => Observable.of());
        expect(link.concat((operation, forward) => forward(operation))).toEqual(
          link,
        );
        expect(warningStub).toHaveBeenCalledTimes(1);
        expect(warningStub.mock.calls[0][0].link).toEqual(link);
      });

      it('should not warn if attempting concat a terminating Link at end', () => {
        const link = new ApolloLink((operation, forward) => forward(operation));
        link.concat(operation => Observable.of());
        expect(warningStub).not.toBeCalled();
      });
    });

    describe('warning', () => {
      it('should include link that terminates', () => {
        const terminatingLink = new ApolloLink(operation =>
          Observable.of({ data }),
        );
        ApolloLink.from([
          new ApolloLink((operation, forward) => forward(operation)),
          new ApolloLink((operation, forward) => forward(operation)),
          terminatingLink,
          new ApolloLink((operation, forward) => forward(operation)),
          new ApolloLink((operation, forward) => forward(operation)),
          new ApolloLink(operation => Observable.of({ data })),
          new ApolloLink((operation, forward) => forward(operation)),
        ]);
        expect(warningStub).toHaveBeenCalledTimes(4);
      });
    });
  });
});
