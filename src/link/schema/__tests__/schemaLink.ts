import { makeExecutableSchema } from '@graphql-tools/schema';
import gql from 'graphql-tag';

import { execute } from '../../core/execute';
import { SchemaLink } from '../';

const sampleQuery = gql`
  query SampleQuery {
    sampleQuery {
      id
    }
  }
`;

const typeDefs = `
type Stub {
  id: String
}

type Query {
  sampleQuery: Stub
}
`;

const schema = makeExecutableSchema({ typeDefs });

describe('SchemaLink', () => {
  it('raises warning if called with concat', () => {
    const link = new SchemaLink({ schema });
    const _warn = console.warn;
    console.warn = (warning: any) => expect(warning['message']).toBeDefined();
    expect(link.concat((operation, forward) => forward(operation))).toEqual(
      link,
    );
    console.warn = _warn;
  });

  it('throws if no arguments given', () => {
    expect(() => new (SchemaLink as any)()).toThrow();
  });

  it('correctly receives the constructor arguments', () => {
    let rootValue = {};
    let link = new SchemaLink({ schema, rootValue });
    expect(link.rootValue).toEqual(rootValue);
    expect(link.schema).toEqual(schema);
  });

  it('calls next and then complete', done => {
    const next = jest.fn();
    const link = new SchemaLink({ schema });
    const observable = execute(link, {
      query: sampleQuery,
    });
    observable.subscribe({
      next,
      error: () => {
        throw new Error('Received error')
      },
      complete: () => {
        expect(next).toHaveBeenCalledTimes(1);
        done();
      },
    });
  });

  it('calls error when fetch fails', done => {
    const link = new SchemaLink({
      validate: true,
      schema: makeExecutableSchema({
        typeDefs,
        resolvers: {
          Query: {
            sampleQuery() {
              throw new Error('Unauthorized');
            }
          }
        }
      }),
    });
    const observable = execute(link, {
      query: sampleQuery,
    });
    observable.subscribe(result => {
      expect(result.errors).toBeTruthy()
      expect(result.errors!.length).toBe(1)
      expect(result.errors![0].message).toMatch(/Unauthorized/)
      done();
    });
  });

  it('supports query which is executed synchronously', done => {
    const next = jest.fn();
    const link = new SchemaLink({ schema });
    const introspectionQuery = gql`
      query IntrospectionQuery {
        __schema {
          types {
            name
          }
        }
      }
    `;
    const observable = execute(link, {
      query: introspectionQuery,
    });
    observable.subscribe(
      next,
      () => {
        throw new Error('Received error')
      },
      () => {
        expect(next).toHaveBeenCalledTimes(1);
        done();
      },
    );
  });

  it('passes operation context into execute with context function', done => {
    const next = jest.fn();
    const contextValue = { some: 'value' };
    const contextProvider = jest.fn(operation => operation.getContext());
    const resolvers = {
      Query: {
        sampleQuery: (root: any, args: any, context: any) => {
          try {
            expect(context).toEqual(contextValue);
          } catch (error) {
            done.fail('Should pass context into resolver');
          }
        },
      },
    };
    const schemaWithResolvers = makeExecutableSchema({
      typeDefs,
      resolvers,
    });
    const link = new SchemaLink({
      schema: schemaWithResolvers,
      context: contextProvider,
    });
    const observable = execute(link, {
      query: sampleQuery,
      context: contextValue,
    });
    observable.subscribe(
      next,
      error => done.fail("Shouldn't call onError"),
      () => {
        try {
          expect(next).toHaveBeenCalledTimes(1);
          expect(contextProvider).toHaveBeenCalledTimes(1);
          done();
        } catch (e) {
          done.fail(e);
        }
      },
    );
  });

  it('passes static context into execute', done => {
    const next = jest.fn();
    const contextValue = { some: 'value' };
    const resolver = jest.fn((root, args, context) => {
      try {
        expect(context).toEqual(contextValue);
      } catch (error) {
        done.fail('Should pass context into resolver');
      }
    });

    const resolvers = {
      Query: {
        sampleQuery: resolver,
      },
    };
    const schemaWithResolvers = makeExecutableSchema({
      typeDefs,
      resolvers,
    });
    const link = new SchemaLink({
      schema: schemaWithResolvers,
      context: contextValue,
    });
    const observable = execute(link, {
      query: sampleQuery,
    });
    observable.subscribe(
      next,
      error => done.fail("Shouldn't call onError"),
      () => {
        try {
          expect(next).toHaveBeenCalledTimes(1);
          expect(resolver).toHaveBeenCalledTimes(1);
          done();
        } catch (e) {
          done.fail(e);
        }
      },
    );
  });

  it('reports errors for unknown queries', done => {
    const link = new SchemaLink({
      validate: true,
      schema: makeExecutableSchema({
        typeDefs,
      }),
    });
    const observable = execute(link, {
      query: gql`
        query {
          unknown
        }
      `
    });
    observable.subscribe(result => {
      expect(result.errors).toBeTruthy()
      expect(result.errors!.length).toBe(1)
      expect(result.errors![0].message).toMatch(/Cannot query field "unknown"/)
      done();
    });
  });
});
