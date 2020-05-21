import type { DataProxy } from './DataProxy';

export namespace Cache {
  export type WatchCallback = (diff: Cache.DiffResult<any>) => void;

  export interface ReadOptions<TVariables = any>
    extends DataProxy.Query<TVariables> {
    rootId?: string;
    previousResult?: any;
    optimistic: boolean;
  }

  export interface WriteOptions<TResult = any, TVariables = any>
    extends DataProxy.Query<TVariables> {
    dataId: string;
    result: TResult;
    broadcast?: boolean;
  }

  export interface DiffOptions extends ReadOptions {
    returnPartialData?: boolean;
  }

  export interface WatchOptions extends ReadOptions {
    immediate?: boolean;
    callback: WatchCallback;
  }

  export interface EvictOptions {
    id: string;
    fieldName?: string;
    args?: Record<string, any>;
    broadcast?: boolean;
  }

  export type DiffResult<T> = DataProxy.DiffResult<T>;
  export type WriteQueryOptions<TData, TVariables> = DataProxy.WriteQueryOptions<TData, TVariables>;
  export type WriteFragmentOptions<TData, TVariables> = DataProxy.WriteFragmentOptions<TData, TVariables>;
  export type Fragment<TVariables> = DataProxy.Fragment<TVariables>;
}
