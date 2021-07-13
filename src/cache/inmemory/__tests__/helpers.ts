import {
  NormalizedCache,
  NormalizedCacheObject,
  DiffQueryAgainstStoreOptions,
} from "../types";
import { EntityStore } from "../entityStore";
import { InMemoryCache } from "../inMemoryCache";
import { StoreReader } from "../readFromStore";
import { StoreWriter } from "../writeToStore";
import { Cache } from "../../../core";

export function defaultNormalizedCacheFactory(
  seed?: NormalizedCacheObject,
): NormalizedCache {
  const cache = new InMemoryCache();
  return new EntityStore.Root({
    policies: cache.policies,
    resultCaching: true,
    seed,
  });
}

interface WriteQueryToStoreOptions extends Cache.WriteOptions {
  writer: StoreWriter;
  store?: NormalizedCache;
};

export function readQueryFromStore<T = any>(
  reader: StoreReader,
  options: DiffQueryAgainstStoreOptions,
) {
  return reader.diffQueryAgainstStore<T>({
    ...options,
    returnPartialData: false,
  }).result;
}

export function writeQueryToStore(
  options: WriteQueryToStoreOptions,
): NormalizedCache {
  const {
    dataId = "ROOT_QUERY",
    store = new EntityStore.Root({
      policies: options.writer.cache.policies,
    }),
    ...writeOptions
  } = options;
  options.writer.writeToStore(store, {
    ...writeOptions,
    dataId,
  });
  return store;
}

export function withError(func: Function, regex?: RegExp) {
  let message: string = null as never;
  const { error } = console;
  console.error = (m: any) => {
    message = m;
  };

  try {
    const result = func();
    if (regex) {
      expect(message).toMatch(regex);
    }
    return result;
  } finally {
    console.error = error;
  }
}

describe("defaultNormalizedCacheFactory", function () {
  it("should return an EntityStore", function () {
    const store = defaultNormalizedCacheFactory();
    expect(store).toBeInstanceOf(EntityStore);
    expect(store).toBeInstanceOf(EntityStore.Root);
  });
});
