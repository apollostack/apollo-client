import { isNonNullObject } from "./objects";

const { hasOwnProperty } = Object.prototype;

// These mergeDeep and mergeDeepArray utilities merge any number of objects
// together, sharing as much memory as possible with the source objects, while
// remaining careful to avoid modifying any source objects.

// Logically, the return type of mergeDeep should be the intersection of
// all the argument types. The binary call signature is by far the most
// common, but we support 0- through 5-ary as well. After that, the
// resulting type is just the inferred array element type. Note to nerds:
// there is a more clever way of doing this that converts the tuple type
// first to a union type (easy enough: T[number]) and then converts the
// union to an intersection type using distributive conditional type
// inference, but that approach has several fatal flaws (boolean becomes
// true & false, and the inferred type ends up as unknown in many cases),
// in addition to being nearly impossible to explain/understand.
export type TupleToIntersection<T extends any[]> =
  T extends [infer A] ? A :
  T extends [infer A, infer B] ? A & B :
  T extends [infer A, infer B, infer C] ? A & B & C :
  T extends [infer A, infer B, infer C, infer D] ? A & B & C & D :
  T extends [infer A, infer B, infer C, infer D, infer E] ? A & B & C & D & E :
  T extends (infer U)[] ? U : any;

export function mergeDeep<T extends any[]>(
  ...sources: T
): TupleToIntersection<T> {
  return mergeDeepArray(sources);
}

// In almost any situation where you could succeed in getting the
// TypeScript compiler to infer a tuple type for the sources array, you
// could just use mergeDeep instead of mergeDeepArray, so instead of
// trying to convert T[] to an intersection type we just infer the array
// element type, which works perfectly when the sources array has a
// consistent element type.
export function mergeDeepArray<T>(sources: T[]): T {
  let target = sources[0] || ({} as T);
  const count = sources.length;
  if (count > 1) {
    const merger = new DeepMerger();
    for (let i = 1; i < count; ++i) {
      target = merger.merge(target, sources[i]);
    }
  }
  return target;
}

export type ReconcilerFunction<TContextArgs extends any[]> = (
  this: DeepMerger<TContextArgs>,
  target: Record<string | number, any>,
  source: Record<string | number, any>,
  property: string | number,
  ...context: TContextArgs
) => any;

const defaultReconciler: ReconcilerFunction<any[]> =
  function (target, source, property) {
    return this.merge(target[property], source[property]);
  };

export class DeepMerger<TContextArgs extends any[]> {
  constructor(
    private reconciler: ReconcilerFunction<TContextArgs> = defaultReconciler,
  ) {}

  public merge(target: any, source: any, ...context: TContextArgs): any {
    if (isNonNullObject(source) && isNonNullObject(target)) {
      Object.keys(source).forEach(sourceKey => {
        if (hasOwnProperty.call(target, sourceKey)) {
          const targetValue = target[sourceKey];
          if (source[sourceKey] !== targetValue) {
            const result = this.reconciler(target, source, sourceKey, ...context);
            // A well-implemented reconciler may return targetValue to indicate
            // the merge changed nothing about the structure of the target.
            if (result !== targetValue) {
              target = this.shallowCopyForMerge(target);
              target[sourceKey] = result;
            }
          }
        } else {
          // If there is no collision, the target can safely share memory with
          // the source, and the recursion can terminate here.
          target = this.shallowCopyForMerge(target);
          target[sourceKey] = source[sourceKey];
        }
      });

      return target;
    }

    // If source (or target) is not an object, let source replace target.
    return source;
  }

  public isObject = isNonNullObject;

  private pastCopies = new Set<any>();

  public shallowCopyForMerge<T>(value: T): T {
    if (isNonNullObject(value) && !this.pastCopies.has(value)) {
      if (Array.isArray(value)) {
        value = (value as any).slice(0);
      } else {
        value = {
          __proto__: Object.getPrototypeOf(value),
          ...value,
        };
      }
      this.pastCopies.add(value);
    }
    return value;
  }
}
