import { NormalizedCacheObject, StoreObject } from "./types";

const hasOwn = Object.prototype.hasOwnProperty;

export class ObjectCache {
  constructor(protected data: NormalizedCacheObject = Object.create(null)) {}

  public toObject() {
    return this.data;
  }

  public get(dataId: string) {
    return this.data[dataId]!;
  }

  public set(dataId: string, value: StoreObject | undefined) {
    this.data[dataId] = value;
  }

  public has(dataId: string): boolean {
    return hasOwn.call(this.data, dataId);
  }

  public delete(dataId: string) {
    delete this.data[dataId];
  }

  public getAllKeys(): string[] {
    return Object.keys(this.data);
  }
}
