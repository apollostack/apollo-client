import gql from 'graphql-tag';
import { ApolloCache } from '../cache';
import { Cache, DataProxy } from '../..';
import { Reference } from '../../../utilities/graphql/storeUtils';

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

  public write<TResult = any, TVariables = any>(
    _: Cache.WriteOptions<TResult, TVariables>,
  ): Reference | undefined {
    return;
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

      test.readQuery({ query });
      expect(test.read).toBeCalled();
    });

    it('defaults optimistic to false', () => {
      const test = new TestCache();
      test.read = ({ optimistic }) => optimistic as any;

      expect(test.readQuery({ query })).toBe(false);
      expect(test.readQuery({ query }, true)).toBe(true);
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

  describe('modifyQuery', () => {
    it('runs the readQuery & writeQuery methods', () => {
      const test = new TestCache();
      test.readQuery = jest.fn();
      test.writeQuery = jest.fn();

      test.modifyQuery({ query }, data => 'foo');

      expect(test.readQuery).toBeCalled();
      expect(test.writeQuery).toBeCalled();
    });

    it('does not call writeQuery method if data is null', () => {
      const test = new TestCache();
      test.readQuery = jest.fn();
      test.writeQuery = jest.fn();

      test.modifyQuery({ query }, data => null);

      expect(test.readQuery).toBeCalled();
      expect(test.writeQuery).not.toBeCalled();
    });

    it('does not call writeQuery method if data is undefined', () => {
      const test = new TestCache();
      test.readQuery = jest.fn();
      test.writeQuery = jest.fn();

      test.modifyQuery({ query }, data => { return; });

      expect(test.readQuery).toBeCalled();
      expect(test.writeQuery).not.toBeCalled();
    });

    it('calls the readQuery & writeQuery methods with the options object', () => {
      const test = new TestCache();
      const options: Cache.ModifyQueryOptions<string, any> = { query, broadcast: true, variables: { test: 1 }, optimistic: true, returnPartialData: true };
      test.readQuery = jest.fn();
      test.writeQuery = jest.fn();

      test.modifyQuery(options, data => 'foo');

      expect(test.readQuery).toBeCalledWith(
        expect.objectContaining(options)
      );

      expect(test.writeQuery).toBeCalledWith(
        expect.objectContaining({ ...options, data: 'foo' })
      );
    });

    it('returns current value in memory if no update was made', () => {
      const test = new TestCache();
      test.readQuery = jest.fn().mockReturnValue('foo');
      expect(test.modifyQuery({ query }, data => null)).toBe('foo');
    });

    it('returns the updated value in memory if an update was made', () => {
      const test = new TestCache();
      let currentValue = 'foo';
      test.readQuery = jest.fn().mockImplementation(() => currentValue);
      test.writeQuery = jest.fn().mockImplementation(({ data }) => currentValue = data);
      expect(test.modifyQuery({ query }, data => 'bar')).toBe('bar');
    });

    it('calls modify function with the current value in memory', () => {
      const test = new TestCache();
      test.readQuery = jest.fn().mockReturnValue('foo');
      test.modifyQuery({ query }, data => {
        expect(data).toBe('foo');
      });
    });
  });

  describe('modifyFragment', () => {
    const fragmentId = 'frag';
    const fragment = gql`
      fragment a on b {
        name
      }
    `;

    it('runs the readFragment & writeFragment methods', () => {
      const test = new TestCache();
      test.readFragment = jest.fn();
      test.writeFragment = jest.fn();

      test.modifyFragment({ id: fragmentId, fragment }, data => 'foo');

      expect(test.readFragment).toBeCalled();
      expect(test.writeFragment).toBeCalled();
    });

    it('does not call writeFragment method if data is null', () => {
      const test = new TestCache();
      test.readFragment = jest.fn();
      test.writeFragment = jest.fn();

      test.modifyFragment({ id: fragmentId, fragment }, data => null);

      expect(test.readFragment).toBeCalled();
      expect(test.writeFragment).not.toBeCalled();
    });

    it('does not call writeFragment method if data is undefined', () => {
      const test = new TestCache();
      test.readFragment = jest.fn();
      test.writeFragment = jest.fn();

      test.modifyFragment({ id: fragmentId, fragment }, data => { return; });

      expect(test.readFragment).toBeCalled();
      expect(test.writeFragment).not.toBeCalled();
    });

    it('calls the readFragment & writeFragment methods with the options object', () => {
      const test = new TestCache();
      const options: Cache.ModifyFragmentOptions<string, any> = { id: fragmentId, fragment, fragmentName: 'a', broadcast: true, variables: { test: 1 }, optimistic: true, returnPartialData: true };
      test.readFragment = jest.fn();
      test.writeFragment = jest.fn();

      test.modifyFragment(options, data => 'foo');

      expect(test.readFragment).toBeCalledWith(
        expect.objectContaining(options)
      );

      expect(test.writeFragment).toBeCalledWith(
        expect.objectContaining({ ...options, data: 'foo' })
      );
    });

    it('returns current value in memory if no update was made', () => {
      const test = new TestCache();
      test.readFragment = jest.fn().mockReturnValue('foo');
      expect(test.modifyFragment({ id: fragmentId, fragment }, data => { return; })).toBe('foo');
    });

    it('returns the updated value in memory if an update was made', () => {
      const test = new TestCache();
      let currentValue = 'foo';
      test.readFragment = jest.fn().mockImplementation(() => currentValue);
      test.writeFragment = jest.fn().mockImplementation(({ data }) => currentValue = data);
      expect(test.modifyFragment({ id: fragmentId, fragment }, data => 'bar')).toBe('bar');
    });

    it('calls modify function with the current value in memory', () => {
      const test = new TestCache();
      test.readFragment = jest.fn().mockReturnValue('foo');
      test.modifyFragment({ id: fragmentId, fragment }, data => {
        expect(data).toBe('foo');
      });
    });
  });
});
