import gql from 'graphql-tag';
import { ApolloCache  } from '../cache';
import type { Cache, DataProxy } from '../..';

class TestCache extends ApolloCache<unknown> {
  constructor() {
    super();
  }

  public diff<T>(query: Cache.DiffOptions): DataProxy.DiffResult<T> {
    return {};
  }

  public evict(): boolean {
    return false;
  }

  public extract(optimistic?: boolean): unknown {
    return undefined;
  }

  public performTransaction(transaction: <TSerialized>(c: ApolloCache<TSerialized>) => void): void {
  }

  public read<T, TVariables = any>(query: Cache.ReadOptions<TVariables>): T | null {
    return null;
  }

  public recordOptimisticTransaction(transaction: <TSerialized>(c: ApolloCache<TSerialized>) => void, id: string): void {
  }

  public removeOptimistic(id: string): void {
  }

  public reset(): Promise<void> {
    return new Promise<void>(() => null);
  }

  public restore(serializedState: unknown): ApolloCache<unknown> {
    return this;
  }

  public watch(watch: Cache.WatchOptions): () => void {
    return function () {
    };
  }

  public write<TResult = any, TVariables = any>(write: Cache.WriteOptions<TResult, TVariables>): void {
  }
}
const query = gql`{ a }`;
describe('abstract cache', () => {
  describe('transformDocument', () => {
    it('returns the document', () => {
      const test = new TestCache();
      expect(test.transformDocument(query)).toBe(query);
    });
  });

  describe('transformForLink', () => {
    it('returns the document', () => {
      const test = new TestCache();
      expect(test.transformForLink(query)).toBe(query);
    });
  });

  describe('readQuery', () => {
    it('runs the read method', () => {
      const test = new TestCache();
      test.read = jest.fn();

      test.readQuery({query});
      expect(test.read).toBeCalled();
    });

    it('defaults optimistic to false', () => {
      const test = new TestCache();
      test.read = ({ optimistic }) => optimistic as any;

      expect(test.readQuery({query})).toBe(false);
      expect(test.readQuery({query}, true)).toBe(true);
    });
  });

  describe('readFragment', () => {
    it('runs the read method', () => {
      const test = new TestCache();
      test.read = jest.fn();
      const fragment = {
        id: 'frag',
        fragment: gql`
          fragment a on b {
            name
          }
        `,
      };

      test.readFragment(fragment);
      expect(test.read).toBeCalled();
    });

    it('defaults optimistic to false', () => {
      const test = new TestCache();
      test.read = ({ optimistic }) => optimistic as any;
      const fragment = {
        id: 'frag',
        fragment: gql`
          fragment a on b {
            name
          }
        `,
      };

      expect(test.readFragment(fragment)).toBe(false);
      expect(test.readFragment(fragment, true)).toBe(true);
    });
  });

  describe('writeQuery', () => {
    it('runs the write method', () => {
      const test = new TestCache();
      test.write = jest.fn();

      test.writeQuery({
        query: query,
        data: 'foo',
      });
      expect(test.write).toBeCalled();
    });
  });

  describe('writeFragment', () => {
    it('runs the write method', () => {
      const test = new TestCache();
      test.write = jest.fn();
      const fragment = {
        id: 'frag',
        fragment: gql`
          fragment a on b {
            name
          }
        `,
        data: 'foo',
      };

      test.writeFragment(fragment);
      expect(test.write).toBeCalled();
    });
  });
});
