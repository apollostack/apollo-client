// Returns true if T is any, or false for any other type.
// Inspired by https://stackoverflow.com/a/61625296/128454.
export type IsStrictlyAny<T> =
  UnionToIntersection<UnionForAny<T>> extends never ? true : false;

// If (and only if) T is any, the union 'a' | 1 is returned here, representing
// both branches of this conditional type. Only UnionForAny<any> produces this
// union type; all other inputs produce the 1 literal type.
type UnionForAny<T> = T extends never ? 'a' : 1;

// If that 'a' | 1 union is then passed to UnionToIntersection, the result
// should be 'a' & 1, which TypeScript simplifies to the never type, since the
// literal type 'a' and the literal type 1 are incompatible. More explanation of
// this helper type: https://stackoverflow.com/a/50375286/62076.
type UnionToIntersection<U> =
  (U extends any ? (k: U) => void : never) extends
    ((k: infer I) => void) ? I : never
