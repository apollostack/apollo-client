// Make builtins like Map and Set safe to use with non-extensible objects.
import './fixPolyfills';

import type { DocumentNode } from 'graphql';
import { dep, wrap } from 'optimism';

import { ApolloCache, Transaction } from '../core/cache';
import type { Cache } from '../core/types/Cache';
import { addTypenameToDocument } from '../../utilities/graphql/transform';
import type { StoreObject }  from '../../utilities/graphql/storeUtils';
import type {
  ApolloReducerConfig,
  NormalizedCacheObject,
} from './types';
import { StoreReader } from './readFromStore';
import { StoreWriter } from './writeToStore';
import { EntityStore, supportsResultCaching } from './entityStore';
import {
  defaultDataIdFromObject,
  PossibleTypesMap,
  Policies,
  TypePolicies,
} from './policies';

export interface InMemoryCacheConfig extends ApolloReducerConfig {
  resultCaching?: boolean;
  possibleTypes?: PossibleTypesMap;
  typePolicies?: TypePolicies;
}

const defaultConfig: InMemoryCacheConfig = {
  dataIdFromObject: defaultDataIdFromObject,
  addTypename: true,
  resultCaching: true,
  typePolicies: {},
};

export class InMemoryCache extends ApolloCache<NormalizedCacheObject> {
  private data: EntityStore;
  private optimisticData: EntityStore;

  protected config: InMemoryCacheConfig;
  private watches = new Set<Cache.WatchOptions>();
  private addTypename: boolean;

  private typenameDocumentCache = new Map<DocumentNode, DocumentNode>();
  private storeReader: StoreReader;
  private storeWriter: StoreWriter;

  // Dynamically imported code can augment existing typePolicies or
  // possibleTypes by calling cache.policies.addTypePolicies or
  // cache.policies.addPossibletypes.
  public readonly policies: Policies;

  constructor(config: InMemoryCacheConfig = {}) {
    super();
    this.config = { ...defaultConfig, ...config };
    this.addTypename = !!this.config.addTypename;

    this.policies = new Policies({
      dataIdFromObject: this.config.dataIdFromObject,
      possibleTypes: this.config.possibleTypes,
      typePolicies: this.config.typePolicies,
    });

    // Passing { resultCaching: false } in the InMemoryCache constructor options
    // will completely disable dependency tracking, which will improve memory
    // usage but worsen the performance of repeated reads.
    this.data = new EntityStore.Root({
      policies: this.policies,
      resultCaching: this.config.resultCaching,
    });

    // When no optimistic writes are currently active, cache.optimisticData ===
    // cache.data, so there are no additional layers on top of the actual data.
    // When an optimistic update happens, this.optimisticData will become a
    // linked list of OptimisticCacheLayer objects that terminates with the
    // original this.data cache object.
    this.optimisticData = this.data;

    this.storeWriter = new StoreWriter({
      policies: this.policies,
      reader: this.storeReader = new StoreReader({
        addTypename: this.addTypename,
        policies: this.policies,
      }),
    });

    const cache = this;
    const { maybeBroadcastWatch } = cache;
    this.maybeBroadcastWatch = wrap((c: Cache.WatchOptions) => {
      return maybeBroadcastWatch.call(this, c);
    }, {
      makeCacheKey(c: Cache.WatchOptions) {
        // Return a cache key (thus enabling result caching) only if we're
        // currently using a data store that can track cache dependencies.
        const store = c.optimistic ? cache.optimisticData : cache.data;
        if (supportsResultCaching(store)) {
          const { optimistic, rootId, variables } = c;
          return store.makeCacheKey(
            c.query,
            // Different watches can have the same query, optimistic
            // status, rootId, and variables, but if their callbacks are
            // different, the (identical) result needs to be delivered to
            // each distinct callback. The easiest way to achieve that
            // separation is to include c.callback in the cache key for
            // maybeBroadcastWatch calls. See issue #5733.
            c.callback,
            JSON.stringify({ optimistic, rootId, variables }),
          );
        }
      }
    });
  }

  public restore(data: NormalizedCacheObject): this {
    if (data) this.data.replace(data);
    return this;
  }

  public extract(optimistic: boolean = false): NormalizedCacheObject {
    return (optimistic ? this.optimisticData : this.data).toObject();
  }

  public read<T>(options: Cache.ReadOptions): T | null {
    const store = options.optimistic ? this.optimisticData : this.data;
    if (typeof options.rootId === 'string' && !store.has(options.rootId)) {
      return null;
    }
    return this.storeReader.readQueryFromStore({
      store,
      query: options.query,
      variables: options.variables,
      rootId: options.rootId,
      config: this.config,
    }) || null;
  }

  public write(options: Cache.WriteOptions): void {
    this.storeWriter.writeQueryToStore({
      store: this.data,
      query: options.query,
      result: options.result,
      dataId: options.dataId,
      variables: options.variables,
    });

    if (options.broadcast !== false) {
      this.broadcastWatches();
    }
  }

  public diff<T>(options: Cache.DiffOptions): Cache.DiffResult<T> {
    return this.storeReader.diffQueryAgainstStore({
      store: options.optimistic ? this.optimisticData : this.data,
      rootId: options.id || "ROOT_QUERY",
      query: options.query,
      variables: options.variables,
      returnPartialData: options.returnPartialData,
      config: this.config,
    });
  }

  public watch(watch: Cache.WatchOptions): () => void {
    this.watches.add(watch);
    if (watch.immediate) {
      this.maybeBroadcastWatch(watch);
    }
    return () => {
      this.watches.delete(watch);
    };
  }

  // Request garbage collection of unreachable normalized entities.
  public gc() {
    return this.optimisticData.gc();
  }

  // Call this method to ensure the given root ID remains in the cache after
  // garbage collection, along with its transitive child entities. Note that
  // the cache automatically retains all directly written entities. By default,
  // the retainment persists after optimistic updates are removed. Pass true
  // for the optimistic argument if you would prefer for the retainment to be
  // discarded when the top-most optimistic layer is removed. Returns the
  // resulting (non-negative) retainment count.
  public retain(rootId: string, optimistic?: boolean): number {
    return (optimistic ? this.optimisticData : this.data).retain(rootId);
  }

  // Call this method to undo the effect of the retain method, above. Once the
  // retainment count falls to zero, the given ID will no longer be preserved
  // during garbage collection, though it may still be preserved by other safe
  // entities that refer to it. Returns the resulting (non-negative) retainment
  // count, in case that's useful.
  public release(rootId: string, optimistic?: boolean): number {
    return (optimistic ? this.optimisticData : this.data).release(rootId);
  }

  // Returns the canonical ID for a given StoreObject, obeying typePolicies
  // and keyFields (and dataIdFromObject, if you still use that). At minimum,
  // the object must contain a __typename and any primary key fields required
  // to identify entities of that type. If you pass a query result object, be
  // sure that none of the primary key fields have been renamed by aliasing.
  public identify(object: StoreObject): string | undefined {
    return this.policies.identify(object)[0];
  }

  public evict(
    idOrOptions: string | Cache.EvictOptions,
    fieldName?: string,
    args?: Record<string, any>,
  ): boolean {
    const evicted = this.optimisticData.evict(
      typeof idOrOptions === "string" ? {
        id: idOrOptions,
        fieldName,
        args,
      } : idOrOptions,
    );
    if (typeof idOrOptions === "string" ||
        idOrOptions.broadcast !== false) {
      this.broadcastWatches();
    }
    return evicted;
  }

  public reset(): Promise<void> {
    this.data.clear();
    this.optimisticData = this.data;
    this.broadcastWatches();
    return Promise.resolve();
  }

  public removeOptimistic(idToRemove: string) {
    const newOptimisticData = this.optimisticData.removeLayer(idToRemove);
    if (newOptimisticData !== this.optimisticData) {
      this.optimisticData = newOptimisticData;
      this.broadcastWatches();
    }
  }

  private txCount = 0;

  public performTransaction(
    transaction: (cache: InMemoryCache) => any,
    // This parameter is not part of the performTransaction signature inherited
    // from the ApolloCache abstract class, but it's useful because it saves us
    // from duplicating this implementation in recordOptimisticTransaction.
    optimisticId?: string,
  ) {
    const perform = (layer?: EntityStore) => {
      const { data, optimisticData } = this;
      ++this.txCount;
      if (layer) {
        this.data = this.optimisticData = layer;
      }
      try {
        transaction(this);
      } finally {
        --this.txCount;
        this.data = data;
        this.optimisticData = optimisticData;
      }
    };

    if (typeof optimisticId === 'string') {
      // Note that there can be multiple layers with the same optimisticId.
      // When removeOptimistic(id) is called for that id, all matching layers
      // will be removed, and the remaining layers will be reapplied.
      this.optimisticData = this.optimisticData.addLayer(optimisticId, perform);
    } else {
      // If we don't have an optimisticId, perform the transaction anyway. Note
      // that this.optimisticData.addLayer calls perform, too.
      perform();
    }

    // This broadcast does nothing if this.txCount > 0.
    this.broadcastWatches();
  }

  public recordOptimisticTransaction(
    transaction: Transaction<NormalizedCacheObject>,
    id: string,
  ) {
    return this.performTransaction(transaction, id);
  }

  public transformDocument(document: DocumentNode): DocumentNode {
    if (this.addTypename) {
      let result = this.typenameDocumentCache.get(document);
      if (!result) {
        result = addTypenameToDocument(document);
        this.typenameDocumentCache.set(document, result);
        // If someone calls transformDocument and then mistakenly passes the
        // result back into an API that also calls transformDocument, make sure
        // we don't keep creating new query documents.
        this.typenameDocumentCache.set(result, result);
      }
      return result;
    }
    return document;
  }

  protected broadcastWatches() {
    if (!this.txCount) {
      this.watches.forEach(c => this.maybeBroadcastWatch(c));
    }
  }

  // This method is wrapped in the constructor so that it will be called only
  // if the data that would be broadcast has changed.
  private maybeBroadcastWatch(c: Cache.WatchOptions) {
    c.callback(
      this.diff({
        query: c.query,
        variables: c.variables,
        optimistic: c.optimistic,
      }),
    );
  }

  private varDep = dep<ReactiveVar<any>>();

  public makeVar<T>(value: T): ReactiveVar<T> {
    const cache = this;
    return function rv(newValue) {
      if (arguments.length > 0) {
        if (value !== newValue) {
          value = newValue!;
          cache.varDep.dirty(rv);
          // In order to perform several ReactiveVar updates without
          // broadcasting each time, use cache.performTransaction.
          cache.broadcastWatches();
        }
      } else {
        cache.varDep(rv);
      }
      return value;
    };
  }
}

export type ReactiveVar<T> = (newValue?: T) => T;
