import { DataProxy } from './DataProxy';
import { Modifier, Modifiers } from './common';

export namespace Cache {
  export type WatchCallback = (diff: Cache.DiffResult<any>) => void;

  export interface ReadOptions<TVariables = any, TData = any>
    extends DataProxy.Query<TVariables, TData> {
    rootId?: string;
    previousResult?: any;
    optimistic: boolean;
    returnPartialData?: boolean;
  }

  export interface WriteOptions<TResult = any, TVariables = any>
    extends DataProxy.Query<TVariables, TResult> {
    dataId?: string;
    result: TResult;
    broadcast?: boolean;
  }

  export interface DiffOptions extends ReadOptions {
    // The DiffOptions interface is currently just an alias for
    // ReadOptions, though DiffOptions used to be responsible for
    // declaring the returnPartialData option.
  }

  export interface WatchOptions extends ReadOptions {
    immediate?: boolean;
    callback: WatchCallback;
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

  export import DiffResult = DataProxy.DiffResult;
  export import ReadQueryOptions = DataProxy.ReadQueryOptions;
  export import ReadFragmentOptions = DataProxy.ReadFragmentOptions;
  export import WriteQueryOptions = DataProxy.WriteQueryOptions;
  export import WriteFragmentOptions = DataProxy.WriteFragmentOptions;
  export import ModifyQueryOptions = DataProxy.ModifyQueryOptions;
  export import ModifyFragmentOptions = DataProxy.ModifyFragmentOptions;
  export import Fragment = DataProxy.Fragment;
}
