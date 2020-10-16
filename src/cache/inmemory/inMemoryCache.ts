// Make builtins like Map and Set safe to use with non-extensible objects.
import './fixPolyfills';

import { DocumentNode } from 'graphql';
import { dep, wrap } from 'optimism';

import { ApolloCache } from '../core/cache';
import { Cache } from '../core/types/Cache';
import {
  addTypenameToDocument,
  StoreObject,
  Reference,
  isReference,
} from '../../utilities';
import {
  ApolloReducerConfig,
  NormalizedCacheObject,
} from './types';
import { StoreReader } from './readFromStore';
import { StoreWriter } from './writeToStore';
import { EntityStore, supportsResultCaching } from './entityStore';
import { makeVar } from './reactiveVars';
import {
  defaultDataIdFromObject,
  PossibleTypesMap,
  Policies,
  TypePolicies,
} from './policies';
import { ObjectCache } from "./objectCache";
import { hasOwn } from './helpers';

export interface InMemoryCacheConfig extends ApolloReducerConfig {
  resultCaching?: boolean;
  possibleTypes?: PossibleTypesMap;
  typePolicies?: TypePolicies;
  objectCache?: ObjectCache;
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

  public readonly makeVar = makeVar;

  constructor(config: InMemoryCacheConfig = {}) {
    super();
    this.config = { ...defaultConfig, ...config };
    this.addTypename = !!this.config.addTypename;

    this.policies = new Policies({
      cache: this,
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
      objectCache: this.config.objectCache
    });

    // When no optimistic writes are currently active, cache.optimisticData ===
    // cache.data, so there are no additional layers on top of the actual data.
    // When an optimistic update happens, this.optimisticData will become a
    // linked list of OptimisticCacheLayer objects that terminates with the
    // original this.data cache object.
    this.optimisticData = this.data;

    this.storeWriter = new StoreWriter(
      this,
      this.storeReader = new StoreReader({
        cache: this,
        addTypename: this.addTypename,
      }),
    );
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

  public write(options: Cache.WriteOptions): Reference | undefined {
    try {
      ++this.txCount;
      return this.storeWriter.writeToStore({
        store: this.data,
        query: options.query,
        result: options.result,
        dataId: options.dataId,
        variables: options.variables,
      });
    } finally {
      if (!--this.txCount && options.broadcast !== false) {
        this.broadcastWatches();
      }
    }
  }

  public modify(options: Cache.ModifyOptions): boolean {
    if (hasOwn.call(options, "id") && !options.id) {
      // To my knowledge, TypeScript does not currently provide a way to
      // enforce that an optional property?:type must *not* be undefined
      // when present. That ability would be useful here, because we want
      // options.id to default to ROOT_QUERY only when no options.id was
      // provided. If the caller attempts to pass options.id with a
      // falsy/undefined value (perhaps because cache.identify failed), we
      // should not assume the goal was to modify the ROOT_QUERY object.
      // We could throw, but it seems natural to return false to indicate
      // that nothing was modified.
      return false;
    }
    const store = options.optimistic // Defaults to false.
      ? this.optimisticData
      : this.data;
    try {
      ++this.txCount;
      return store.modify(options.id || "ROOT_QUERY", options.fields);
    } finally {
      if (!--this.txCount && options.broadcast !== false) {
        this.broadcastWatches();
      }
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
  // If you pass a Reference object, its __ref ID string will be returned.
  public identify(object: StoreObject | Reference): string | undefined {
    return isReference(object) ? object.__ref :
      this.policies.identify(object)[0];
  }

  public evict(options: Cache.EvictOptions): boolean {
    if (!options.id) {
      if (hasOwn.call(options, "id")) {
        // See comment in modify method about why we return false when
        // options.id exists but is falsy/undefined.
        return false;
      }
      options = { ...options, id: "ROOT_QUERY" };
    }
    try {
      // It's unlikely that the eviction will end up invoking any other
      // cache update operations while it's running, but {in,de}crementing
      // this.txCount still seems like a good idea, for uniformity with
      // the other update methods.
      ++this.txCount;
      return this.optimisticData.evict(options);
    } finally {
      if (!--this.txCount && options.broadcast !== false) {
        this.broadcastWatches();
      }
    }
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
    optimisticId?: string | null,
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
    } else if (optimisticId === null) {
      // Ensure both this.data and this.optimisticData refer to the root
      // (non-optimistic) layer of the cache during the transaction. Note
      // that this.data could be a Layer if we are currently executing an
      // optimistic transaction function, but otherwise will always be an
      // EntityStore.Root instance.
      perform(this.data);
    } else {
      // Otherwise, leave this.data and this.optimisticData unchanged and
      // run the transaction with broadcast batching.
      perform();
    }

    // This broadcast does nothing if this.txCount > 0.
    this.broadcastWatches();
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

  private maybeBroadcastWatch = wrap((c: Cache.WatchOptions) => {
    return this.broadcastWatch.call(this, c);
  }, {
    makeCacheKey: (c: Cache.WatchOptions) => {
      // Return a cache key (thus enabling result caching) only if we're
      // currently using a data store that can track cache dependencies.
      const store = c.optimistic ? this.optimisticData : this.data;
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

  private watchDep = dep<Cache.WatchOptions>();

  // This method is wrapped by maybeBroadcastWatch, which is called by
  // broadcastWatches, so that we compute and broadcast results only when
  // the data that would be broadcast might have changed. It would be
  // simpler to check for changes after recomputing a result but before
  // broadcasting it, but this wrapping approach allows us to skip both
  // the recomputation and the broadcast, in most cases.
  private broadcastWatch(c: Cache.WatchOptions) {
    // First, invalidate any other maybeBroadcastWatch wrapper functions
    // currently depending on this Cache.WatchOptions object (including
    // the one currently calling broadcastWatch), so they will be included
    // in the next broadcast, even if the result they receive is the same
    // as the previous result they received. This is important because we
    // are about to deliver a different result to c.callback, so any
    // previous results should have a chance to be redelivered.
    this.watchDep.dirty(c);

    // Next, re-depend on this.watchDep for just this invocation of
    // maybeBroadcastWatch (this is a no-op if broadcastWatch was not
    // called by maybeBroadcastWatch). This allows only the most recent
    // maybeBroadcastWatch invocation for this watcher to remain cached,
    // enabling re-broadcast of previous results even if they have not
    // changed since they were previously delivered.
    this.watchDep(c);

    c.callback(this.diff({
      query: c.query,
      variables: c.variables,
      optimistic: c.optimistic,
    }));
  }
}
