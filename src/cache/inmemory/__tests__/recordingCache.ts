import type { NormalizedCacheObject, StoreObject } from '../types';
import { EntityStore } from '../entityStore';
import { Policies } from '../policies';

describe('Optimistic EntityStore layering', () => {
  function makeLayer(root: EntityStore) {
    return root.addLayer('whatever', () => {});
  }

  function lookup(store: EntityStore, dataId: string) {
    return (store as any).lookup(dataId) as StoreObject;
  }

  describe('returns correct values during recording', () => {
    const data = {
      Human: { __typename: 'Human', name: 'Mark' },
      Animal: { __typename: 'Mouse', name: '🐭' },
    };

    const dataToRecord = {
      Human: { __typename: 'Human', name: 'John' },
    };

    const underlyingStore = new EntityStore.Root({ seed: data, policies: new Policies() });

    let store = makeLayer(underlyingStore);
    beforeEach(() => {
      store = makeLayer(underlyingStore);
    });

    it('should passthrough values if not defined in recording', () => {
      expect(lookup(store, 'Human')).toBe(data.Human);
      expect(lookup(store, 'Animal')).toBe(data.Animal);
    });

    it('should return values defined during recording', () => {
      store.merge('Human', dataToRecord.Human);
      expect(lookup(store, 'Human')).toEqual(dataToRecord.Human);
      expect(lookup(underlyingStore, 'Human')).toBe(data.Human);
    });

    it('should return undefined for values deleted during recording', () => {
      expect(lookup(store, 'Animal')).toBe(data.Animal);
      // delete should be registered in the recording:
      store.delete('Animal');
      expect(lookup(store, 'Animal')).toBeUndefined();
      expect(store.toObject()).toHaveProperty('Animal');
      expect(lookup(underlyingStore, 'Animal')).toBe(data.Animal);
    });
  });

  describe('returns correct result of a recorded transaction', () => {
    const data = {
      Human: { __typename: 'Human', name: 'Mark' },
      Animal: { __typename: 'Mouse', name: '🐭' },
    };

    const dataToRecord = {
      Human: { __typename: 'Human', name: 'John' },
    };

    const underlyingStore = new EntityStore.Root({ seed: data, policies: new Policies() });
    let store = makeLayer(underlyingStore);
    let recording: NormalizedCacheObject;

    beforeEach(() => {
      store = makeLayer(underlyingStore);
      store.merge('Human', dataToRecord.Human);
      store.delete('Animal');
      recording = store.toObject();
    });

    it('should contain the property indicating deletion', () => {
      expect(recording).toHaveProperty('Animal');
    });

    it('should have recorded the changes made during recording', () => {
      expect(recording).toEqual({
        Human: dataToRecord.Human,
        Animal: undefined,
      });
    });

    it('should keep the original data unaffected', () => {
      expect(underlyingStore.toObject()).toEqual(data);
    });
  });
});
