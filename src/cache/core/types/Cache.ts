import { DataProxy } from './DataProxy';
import { Modifier, Modifiers } from './common';
import { ApolloCache } from '../cache';

export namespace Cache {
  export type WatchCallback = (
    diff: Cache.DiffResult<any>,
    lastDiff?: Cache.DiffResult<any>,
  ) => void;

  export interface ReadOptions<TVariables = any, TData = any>
    extends DataProxy.Query<TVariables, TData> {
    rootId?: string;
    previousResult?: any;
    optimistic: boolean;
    returnPartialData?: boolean;
    canonizeResults?: boolean;
  }

  export interface WriteOptions<TResult = any, TVariables = any>
    extends Omit<DataProxy.Query<TVariables, TResult>, "id">,
            Omit<DataProxy.WriteOptions<TResult>, "data">
  {
    dataId?: string;
    result: TResult;
  }

  export interface DiffOptions extends ReadOptions {
    // The DiffOptions interface is currently just an alias for
    // ReadOptions, though DiffOptions used to be responsible for
    // declaring the returnPartialData option.
  }

  export interface WatchOptions<
    Watcher extends object = Record<string, any>
  > extends ReadOptions {
    watcher?: Watcher;
    immediate?: boolean;
    callback: WatchCallback;
    lastDiff?: DiffResult<any>;
  }

  export interface EvictOptions {
    id?: string;
    fieldName?: string;
    args?: Record<string, any>;
    broadcast?: boolean;
  }

  export interface ModifyOptions {
    id?: string;
    fields: Modifiers | Modifier<any>;
    optimistic?: boolean;
    broadcast?: boolean;
  }

  export interface BatchOptions<C extends ApolloCache<any>> {
    // Same as the first parameter of performTransaction, except the cache
    // argument will have the subclass type rather than ApolloCache.
    update(cache: C): void;

    // Passing a string for this option creates a new optimistic layer, with the
    // given string as its layer.id, just like passing a string for the
    // optimisticId parameter of performTransaction. Passing true is the same as
    // passing undefined to performTransaction (running the batch operation
    // against the current top layer of the cache), and passing false is the
    // same as passing null (running the operation against root/non-optimistic
    // cache data).
    optimistic: string | boolean;

    // If you specify the ID of an optimistic layer using this option, that
    // layer will be removed as part of the batch transaction, triggering at
    // most one broadcast for both the transaction and the removal of the layer.
    // Note: this option is needed because calling cache.removeOptimistic during
    // the transaction function may not be not safe, since any modifications to
    // cache layers may be discarded after the transaction finishes.
    removeOptimistic?: string;

    // If you want to find out which watched queries were invalidated during
    // this batch operation, pass this optional callback function. Returning
    // false from the callback will prevent broadcasting this result.
    onWatchUpdated?: (
      this: C,
      watch: Cache.WatchOptions,
      diff: Cache.DiffResult<any>,
      lastDiff: Cache.DiffResult<any> | undefined,
    ) => any;
  }

  export import DiffResult = DataProxy.DiffResult;
  export import ReadQueryOptions = DataProxy.ReadQueryOptions;
  export import ReadFragmentOptions = DataProxy.ReadFragmentOptions;
  export import WriteQueryOptions = DataProxy.WriteQueryOptions;
  export import WriteFragmentOptions = DataProxy.WriteFragmentOptions;
  export import Fragment = DataProxy.Fragment;
}
