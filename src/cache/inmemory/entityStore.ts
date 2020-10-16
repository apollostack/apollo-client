import { dep, OptimisticDependencyFunction, KeyTrie } from 'optimism';
import { equal } from '@wry/equality';

import {
  isReference,
  StoreValue,
  StoreObject,
  Reference,
  makeReference,
  DeepMerger,
  maybeDeepFreeze,
  canUseWeakMap,
} from '../../utilities';
import { NormalizedCache, NormalizedCacheObject } from './types';
import { hasOwn, fieldNameFromStoreName } from './helpers';
import { Policies } from './policies';
import { ObjectCache } from './objectCache';
import { Cache } from '../core/types/Cache';
import {
  SafeReadonly,
  Modifier,
  Modifiers,
  ReadFieldFunction,
  ReadFieldOptions,
  ToReferenceFunction,
  CanReadFunction,
} from '../core/types/common';

const DELETE: any = Object.create(null);
const delModifier: Modifier<any> = () => DELETE;

export abstract class EntityStore implements NormalizedCache {

  constructor(
    public readonly policies: Policies,
    public readonly group: CacheGroup,
    protected cache: ObjectCache = new ObjectCache()
  ) {}

  public abstract addLayer(
    layerId: string,
    replay: (layer: EntityStore) => any,
  ): Layer;

  public abstract removeLayer(layerId: string): EntityStore;

  // Although the EntityStore class is abstract, it contains concrete
  // implementations of the various NormalizedCache interface methods that
  // are inherited by the Root and Layer subclasses.

  public toObject(): NormalizedCacheObject {
    return { ...this.cache.toObject() };
  }

  public has(dataId: string): boolean {
    return this.lookup(dataId, true) !== void 0;
  }

  public get(dataId: string, fieldName: string): StoreValue {
    this.group.depend(dataId, fieldName);
    if (this.cache.has(dataId)) {
      const storeObject = this.cache.get(dataId);
      if (storeObject && hasOwn.call(storeObject, fieldName)) {
        return storeObject[fieldName];
      }
    }
    if (fieldName === "__typename" &&
        hasOwn.call(this.policies.rootTypenamesById, dataId)) {
      return this.policies.rootTypenamesById[dataId];
    }
    if (this instanceof Layer) {
      return this.parent.get(dataId, fieldName);
    }
  }

  protected lookup(dataId: string, dependOnExistence?: boolean): StoreObject | undefined {
    // The has method (above) calls lookup with dependOnExistence = true, so
    // that it can later be invalidated when we add or remove a StoreObject for
    // this dataId. Any consumer who cares about the contents of the StoreObject
    // should not rely on this dependency, since the contents could change
    // without the object being added or removed.
    if (dependOnExistence) this.group.depend(dataId, "__exists");
    return this.cache.has(dataId) ? this.cache.get(dataId) :
      this instanceof Layer ? this.parent.lookup(dataId, dependOnExistence) : void 0;
  }

  public merge(dataId: string, incoming: StoreObject): void {
    const existing = this.lookup(dataId);
    const merged = new DeepMerger(storeObjectReconciler).merge(existing, incoming);
    // Even if merged === existing, existing may have come from a lower
    // layer, so we always need to set this.data[dataId] on this level.
    this.cache.set(dataId, merged)
    if (merged !== existing) {
      delete this.refs[dataId];
      if (this.group.caching) {
        const fieldsToDirty: Record<string, 1> = Object.create(null);
        // If we added a new StoreObject where there was previously none, dirty
        // anything that depended on the existence of this dataId, such as the
        // EntityStore#has method.
        if (!existing) fieldsToDirty.__exists = 1;
        // Now invalidate dependents who called getFieldValue for any fields
        // that are changing as a result of this merge.
        Object.keys(incoming).forEach(storeFieldName => {
          if (!existing || existing[storeFieldName] !== merged[storeFieldName]) {
            fieldsToDirty[fieldNameFromStoreName(storeFieldName)] = 1;
            // If merged[storeFieldName] has become undefined, and this is the
            // Root layer, actually delete the property from the merged object,
            // which is guaranteed to have been created fresh in this method.
            if (merged[storeFieldName] === void 0 && !(this instanceof Layer)) {
              delete merged[storeFieldName];
            }
          }
        });
        Object.keys(fieldsToDirty).forEach(
          fieldName => this.group.dirty(dataId, fieldName));
      }
    }
  }

  public modify(
    dataId: string,
    fields: Modifier<any> | Modifiers,
  ): boolean {
    const storeObject = this.lookup(dataId);

    if (storeObject) {
      const changedFields: Record<string, any> = Object.create(null);
      let needToMerge = false;
      let allDeleted = true;

      const readField: ReadFieldFunction = <V = StoreValue>(
        fieldNameOrOptions: string | ReadFieldOptions,
        from?: StoreObject | Reference,
      ) => this.policies.readField<V>(
        typeof fieldNameOrOptions === "string" ? {
          fieldName: fieldNameOrOptions,
          from: from || makeReference(dataId),
        } : fieldNameOrOptions,
        { store: this },
      );

      Object.keys(storeObject).forEach(storeFieldName => {
        const fieldName = fieldNameFromStoreName(storeFieldName);
        let fieldValue = storeObject[storeFieldName];
        if (fieldValue === void 0) return;
        const modify: Modifier<StoreValue> = typeof fields === "function"
          ? fields
          : fields[storeFieldName] || fields[fieldName];
        if (modify) {
          let newValue = modify === delModifier ? DELETE :
            modify(maybeDeepFreeze(fieldValue), {
              DELETE,
              fieldName,
              storeFieldName,
              isReference,
              toReference: this.toReference,
              canRead: this.canRead,
              readField,
            });
          if (newValue === DELETE) newValue = void 0;
          if (newValue !== fieldValue) {
            changedFields[storeFieldName] = newValue;
            needToMerge = true;
            fieldValue = newValue;
          }
        }
        if (fieldValue !== void 0) {
          allDeleted = false;
        }
      });

      if (needToMerge) {
        this.merge(dataId, changedFields);

        if (allDeleted) {
          if (this instanceof Layer) {
            this.cache.set(dataId, void 0);
          } else {
            this.cache.delete(dataId);
          }
          this.group.dirty(dataId, "__exists");
        }

        return true;
      }
    }

    return false;
  }

  // If called with only one argument, removes the entire entity
  // identified by dataId. If called with a fieldName as well, removes all
  // fields of that entity whose names match fieldName according to the
  // fieldNameFromStoreName helper function. If called with a fieldName
  // and variables, removes all fields of that entity whose names match fieldName
  // and whose arguments when cached exactly match the variables passed.
  public delete(
    dataId: string,
    fieldName?: string,
    args?: Record<string, any>,
  ) {
    const storeObject = this.lookup(dataId);
    if (storeObject) {
      const typename = this.getFieldValue<string>(storeObject, "__typename");
      const storeFieldName = fieldName && args
        ? this.policies.getStoreFieldName({ typename, fieldName, args })
        : fieldName;
      return this.modify(dataId, storeFieldName ? {
        [storeFieldName]: delModifier,
      } : delModifier);
    }
    return false;
  }

  public evict(options: Cache.EvictOptions): boolean {
    let evicted = false;
    if (options.id) {
      if (this.cache.has(options.id)) {
        evicted = this.delete(options.id, options.fieldName, options.args);
      }
      if (this instanceof Layer) {
        evicted = this.parent.evict(options) || evicted;
      }
      // Always invalidate the field to trigger rereading of watched
      // queries, even if no cache data was modified by the eviction,
      // because queries may depend on computed fields with custom read
      // functions, whose values are not stored in the EntityStore.
      if (options.fieldName || evicted) {
        this.group.dirty(options.id, options.fieldName || "__exists");
      }
    }
    return evicted;
  }

  public clear(): void {
    this.replace(null);
  }

  public replace(newData: NormalizedCacheObject | null): void {
    this.cache.getAllKeys().forEach(dataId => {
      if (!(newData && hasOwn.call(newData, dataId))) {
        this.delete(dataId);
      }
    });
    if (newData) {
      Object.keys(newData).forEach(dataId => {
        this.merge(dataId, newData[dataId] as StoreObject);
      });
    }
  }

  // Maps root entity IDs to the number of times they have been retained, minus
  // the number of times they have been released. Retained entities keep other
  // entities they reference (even indirectly) from being garbage collected.
  private rootIds: {
    [rootId: string]: number;
  } = Object.create(null);

  public retain(rootId: string): number {
    return this.rootIds[rootId] = (this.rootIds[rootId] || 0) + 1;
  }

  public release(rootId: string): number {
    if (this.rootIds[rootId] > 0) {
      const count = --this.rootIds[rootId];
      if (!count) delete this.rootIds[rootId];
      return count;
    }
    return 0;
  }

  // Return a Set<string> of all the ID strings that have been retained by
  // this layer/root *and* any layers/roots beneath it.
  public getRootIdSet(ids = new Set<string>()) {
    Object.keys(this.rootIds).forEach(ids.add, ids);
    if (this instanceof Layer) {
      this.parent.getRootIdSet(ids);
    }
    return ids;
  }

  // The goal of garbage collection is to remove IDs from the Root layer of the
  // store that are no longer reachable starting from any IDs that have been
  // explicitly retained (see retain and release, above). Returns an array of
  // dataId strings that were removed from the store.
  public gc() {
    const ids = this.getRootIdSet();
    const snapshot = this.toObject();
    ids.forEach(id => {
      if (hasOwn.call(snapshot, id)) {
        // Because we are iterating over an ECMAScript Set, the IDs we add here
        // will be visited in later iterations of the forEach loop only if they
        // were not previously contained by the Set.
        Object.keys(this.findChildRefIds(id)).forEach(ids.add, ids);
        // By removing IDs from the snapshot object here, we protect them from
        // getting removed from the root store layer below.
        delete snapshot[id];
      }
    });
    const idsToRemove = Object.keys(snapshot);
    if (idsToRemove.length) {
      let root: EntityStore = this;
      while (root instanceof Layer) root = root.parent;
      idsToRemove.forEach(id => root.delete(id));
    }
    return idsToRemove;
  }

  // Lazily tracks { __ref: <dataId> } strings contained by this.data[dataId].
  private refs: {
    [dataId: string]: Record<string, true>;
  } = Object.create(null);

  public findChildRefIds(dataId: string): Record<string, true> {
    if (!hasOwn.call(this.refs, dataId)) {
      const found = this.refs[dataId] = Object.create(null);
      const workSet = new Set([this.cache.get(dataId)]);
      // Within the store, only arrays and objects can contain child entity
      // references, so we can prune the traversal using this predicate:
      const canTraverse = (obj: any) => obj !== null && typeof obj === 'object';
      workSet.forEach(obj => {
        if (isReference(obj)) {
          found[obj.__ref] = true;
        } else if (canTraverse(obj)) {
          Object.values(obj!)
            // No need to add primitive values to the workSet, since they cannot
            // contain reference objects.
            .filter(canTraverse)
            .forEach(workSet.add, workSet);
        }
      });
    }
    return this.refs[dataId];
  }

  // Used to compute cache keys specific to this.group.
  public makeCacheKey(...args: any[]) {
    return this.group.keyMaker.lookupArray(args);
  }

  // Bound function that can be passed around to provide easy access to fields
  // of Reference objects as well as ordinary objects.
  public getFieldValue = <T = StoreValue>(
    objectOrReference: StoreObject | Reference,
    storeFieldName: string,
  ) => maybeDeepFreeze(
    isReference(objectOrReference)
      ? this.get(objectOrReference.__ref, storeFieldName)
      : objectOrReference && objectOrReference[storeFieldName]
  ) as SafeReadonly<T>;

  // Returns true for non-normalized StoreObjects and non-dangling
  // References, indicating that readField(name, objOrRef) has a chance of
  // working. Useful for filtering out dangling references from lists.
  public canRead: CanReadFunction = objOrRef => {
    return isReference(objOrRef)
      ? this.has(objOrRef.__ref)
      : typeof objOrRef === "object";
  };

  // Bound function that converts an id or an object with a __typename and
  // primary key fields to a Reference object. If called with a Reference object,
  // that same Reference object is returned. Pass true for mergeIntoStore to persist
  // an object into the store.
  public toReference: ToReferenceFunction = (
    objOrIdOrRef,
    mergeIntoStore,
  ) => {
    if (typeof objOrIdOrRef === "string") {
      return makeReference(objOrIdOrRef);
    }

    if (isReference(objOrIdOrRef)) {
      return objOrIdOrRef;
    }

    const [id] = this.policies.identify(objOrIdOrRef);

    if (id) {
      const ref = makeReference(id);
      if (mergeIntoStore) {
        this.merge(id, objOrIdOrRef);
      }
      return ref;
    }
  };
}

export type FieldValueGetter = EntityStore["getFieldValue"];

// A single CacheGroup represents a set of one or more EntityStore objects,
// typically the Root store in a CacheGroup by itself, and all active Layer
// stores in a group together. A single EntityStore object belongs to only
// one CacheGroup, store.group. The CacheGroup is responsible for tracking
// dependencies, so store.group is helpful for generating unique keys for
// cached results that need to be invalidated when/if those dependencies
// change. If we used the EntityStore objects themselves as cache keys (that
// is, store rather than store.group), the cache would become unnecessarily
// fragmented by all the different Layer objects. Instead, the CacheGroup
// approach allows all optimistic Layer objects in the same linked list to
// belong to one CacheGroup, with the non-optimistic Root object belonging
// to another CacheGroup, allowing resultCaching dependencies to be tracked
// separately for optimistic and non-optimistic entity data.
class CacheGroup {
  private d: OptimisticDependencyFunction<string> | null = null;

  constructor(public readonly caching: boolean) {
    this.d = caching ? dep<string>() : null;
  }

  public depend(dataId: string, storeFieldName: string) {
    if (this.d) {
      this.d(makeDepKey(dataId, storeFieldName));
    }
  }

  public dirty(dataId: string, storeFieldName: string) {
    if (this.d) {
      this.d.dirty(makeDepKey(dataId, storeFieldName));
    }
  }

  // Used by the EntityStore#makeCacheKey method to compute cache keys
  // specific to this CacheGroup.
  public readonly keyMaker = new KeyTrie<object>(canUseWeakMap);
}

function makeDepKey(dataId: string, storeFieldName: string) {
  // Since field names cannot have '#' characters in them, this method
  // of joining the field name and the ID should be unambiguous, and much
  // cheaper than JSON.stringify([dataId, fieldName]).
  return fieldNameFromStoreName(storeFieldName) + '#' + dataId;
}

export namespace EntityStore {
  // Refer to this class as EntityStore.Root outside this namespace.
  export class Root extends EntityStore {
    // Although each Root instance gets its own unique CacheGroup object,
    // any Layer instances created by calling addLayer need to share a
    // single distinct CacheGroup object. Since this shared object must
    // outlast the Layer instances themselves, it needs to be created and
    // owned by the Root instance.
    private sharedLayerGroup: CacheGroup;

    constructor({
      policies,
      resultCaching = true,
      seed,
      objectCache
    }: {
      policies: Policies;
      resultCaching?: boolean;
      seed?: NormalizedCacheObject;
      objectCache?: ObjectCache;
    }) {
      super(policies, new CacheGroup(resultCaching), objectCache);
      this.sharedLayerGroup = new CacheGroup(resultCaching);
      if (seed) this.replace(seed);
    }

    public addLayer(
      layerId: string,
      replay: (layer: EntityStore) => any,
    ): Layer {
      // The replay function will be called in the Layer constructor.
      return new Layer(layerId, this, replay, this.sharedLayerGroup);
    }

    public removeLayer(): Root {
      // Never remove the root layer.
      return this;
    }
  }
}

// Not exported, since all Layer instances are created by the addLayer method
// of the EntityStore.Root class.
class Layer extends EntityStore {
  constructor(
    public readonly id: string,
    public readonly parent: EntityStore,
    public readonly replay: (layer: EntityStore) => any,
    public readonly group: CacheGroup,
  ) {
    super(parent.policies, group);
    replay(this);
  }

  public addLayer(
    layerId: string,
    replay: (layer: EntityStore) => any,
  ): Layer {
    return new Layer(layerId, this, replay, this.group);
  }

  public removeLayer(layerId: string): EntityStore {
    // Remove all instances of the given id, not just the first one.
    const parent = this.parent.removeLayer(layerId);

    if (layerId === this.id) {
      // Dirty every ID we're removing.
      if (this.group.caching) {
        this.cache.getAllKeys().forEach(dataId => {
          // If this.data[dataId] contains nothing different from what
          // lies beneath, we can avoid dirtying this dataId and all of
          // its fields, and simply discard this Layer. The only reason we
          // call this.delete here is to dirty the removed fields.
          if (this.cache.get(dataId) !== (parent as Layer).lookup(dataId)) {
            this.delete(dataId);
          }
        });
      }
      return parent;
    }

    // No changes are necessary if the parent chain remains identical.
    if (parent === this.parent) return this;

    // Recreate this layer on top of the new parent.
    return parent.addLayer(this.id, this.replay);
  }

  public toObject(): NormalizedCacheObject {
    return {
      ...this.parent.toObject(),
      ...this.cache.toObject()
    };
  }

  public findChildRefIds(dataId: string): Record<string, true> {
    const fromParent = this.parent.findChildRefIds(dataId);
    return this.cache.has(dataId) ? {
      ...fromParent,
      ...super.findChildRefIds(dataId),
    } : fromParent;
  }
}

function storeObjectReconciler(
  existingObject: StoreObject,
  incomingObject: StoreObject,
  property: string,
): StoreValue {
  const existingValue = existingObject[property];
  const incomingValue = incomingObject[property];
  // Wherever there is a key collision, prefer the incoming value, unless
  // it is deeply equal to the existing value. It's worth checking deep
  // equality here (even though blindly returning incoming would be
  // logically correct) because preserving the referential identity of
  // existing data can prevent needless rereading and rerendering.
  return equal(existingValue, incomingValue) ? existingValue : incomingValue;
}

export function supportsResultCaching(store: any): store is EntityStore {
  // When result caching is disabled, store.depend will be null.
  return !!(store instanceof EntityStore && store.group.caching);
}
