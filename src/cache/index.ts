import { invariant } from "ts-invariant";
import { DEV } from "../utilities";
invariant("boolean" === typeof DEV, DEV);

export { Transaction, ApolloCache } from './core/cache';
export { Cache } from './core/types/Cache';
export { DataProxy } from './core/types/DataProxy';
export {
  MissingFieldError,
  ReadFieldOptions
} from './core/types/common';

export {
  Reference,
  isReference,
  makeReference,
} from '../utilities';

export { EntityStore } from './inmemory/entityStore';
export { fieldNameFromStoreName } from './inmemory/helpers'

export {
  InMemoryCache,
  InMemoryCacheConfig,
} from './inmemory/inMemoryCache';

export {
  ReactiveVar,
  makeVar,
  cacheSlot,
} from './inmemory/reactiveVars';

export {
  defaultDataIdFromObject,
  TypePolicies,
  TypePolicy,
  FieldPolicy,
  FieldReadFunction,
  FieldMergeFunction,
  FieldFunctionOptions,
  PossibleTypesMap,
  Policies,
} from './inmemory/policies';

export {
  canonicalStringify,
} from './inmemory/object-canon';

export * from './inmemory/types';
