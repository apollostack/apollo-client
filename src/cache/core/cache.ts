import type { DocumentNode } from 'graphql';
import { wrap } from 'optimism';

import { getFragmentQueryDocument } from '../../utilities/graphql/fragments';
import type { StoreObject } from '../../utilities/graphql/storeUtils';
import type { DataProxy } from './types/DataProxy';
import type { Cache } from './types/Cache';

export type Transaction<T> = (c: ApolloCache<T>) => void;

export abstract class ApolloCache<TSerialized> implements DataProxy {
  // required to implement
  // core API
  public abstract read<T, TVariables = any>(
    query: Cache.ReadOptions<TVariables>,
  ): T | null;
  public abstract write<TResult = any, TVariables = any>(
    write: Cache.WriteOptions<TResult, TVariables>,
  ): void;
  public abstract diff<T>(query: Cache.DiffOptions): Cache.DiffResult<T>;
  public abstract watch(watch: Cache.WatchOptions): () => void;
  public abstract reset(): Promise<void>;

  // Remove whole objects from the cache by passing just options.id, or
  // specific fields by passing options.field and/or options.args. If no
  // options.args are provided, all fields matching options.field (even
  // those with arguments) will be removed. Returns true iff any data was
  // removed from the cache.
  public abstract evict(options: Cache.EvictOptions): boolean;

  // For backwards compatibility, evict can also take positional
  // arguments. Please prefer the Cache.EvictOptions style (above).
  public abstract evict(
    id: string,
    field?: string,
    args?: Record<string, any>,
  ): boolean;

  // intializer / offline / ssr API
  /**
   * Replaces existing state in the cache (if any) with the values expressed by
   * `serializedState`.
   *
   * Called when hydrating a cache (server side rendering, or offline storage),
   * and also (potentially) during hot reloads.
   */
  public abstract restore(
    serializedState: TSerialized,
  ): ApolloCache<TSerialized>;

  /**
   * Exposes the cache's complete state, in a serializable format for later restoration.
   */
  public abstract extract(optimistic?: boolean): TSerialized;

  // Optimistic API

  public abstract removeOptimistic(id: string): void;

  // Transactional API

  public abstract performTransaction(
    transaction: Transaction<TSerialized>,
  ): void;

  public abstract recordOptimisticTransaction(
    transaction: Transaction<TSerialized>,
    id: string,
  ): void;

  // Optional API

  public transformDocument(document: DocumentNode): DocumentNode {
    return document;
  }

  public identify(object: StoreObject): string | undefined {
    return;
  }

  public gc(): string[] {
    return [];
  }

  // Experimental API

  public transformForLink(document: DocumentNode): DocumentNode {
    return document;
  }

  // DataProxy API
  /**
   *
   * @param options
   * @param optimistic
   */
  public readQuery<QueryType, TVariables = any>(
    options: DataProxy.Query<TVariables>,
    optimistic: boolean = false,
  ): QueryType | null {
    return this.read({
      rootId: options.id || 'ROOT_QUERY',
      query: options.query,
      variables: options.variables,
      optimistic,
    });
  }

  // Make sure we compute the same (===) fragment query document every
  // time we receive the same fragment in readFragment.
  private getFragmentDoc = wrap(getFragmentQueryDocument);

  public readFragment<FragmentType, TVariables = any>(
    options: DataProxy.Fragment<TVariables>,
    optimistic: boolean = false,
  ): FragmentType | null {
    return this.read({
      query: this.getFragmentDoc(options.fragment, options.fragmentName),
      variables: options.variables,
      rootId: options.id,
      optimistic,
    });
  }

  public writeQuery<TData = any, TVariables = any>(
    options: Cache.WriteQueryOptions<TData, TVariables>,
  ): void {
    this.write({
      dataId: options.id || 'ROOT_QUERY',
      result: options.data,
      query: options.query,
      variables: options.variables,
      broadcast: options.broadcast,
    });
  }

  public writeFragment<TData = any, TVariables = any>(
    options: Cache.WriteFragmentOptions<TData, TVariables>,
  ): void {
    this.write({
      dataId: options.id,
      result: options.data,
      variables: options.variables,
      query: this.getFragmentDoc(options.fragment, options.fragmentName),
      broadcast: options.broadcast,
    });
  }
}
