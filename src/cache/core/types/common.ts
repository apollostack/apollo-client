import type { DocumentNode } from 'graphql';

// The Readonly<T> type only really works for object types, since it marks
// all of the object's properties as readonly, but there are many cases when
// a generic type parameter like TExisting might be a string or some other
// primitive type, in which case we need to avoid wrapping it with Readonly.
// SafeReadonly<string> collapses to just string, which makes string
// assignable to SafeReadonly<any>, whereas string is not assignable to
// Readonly<any>, somewhat surprisingly.
export type SafeReadonly<T> = T extends object ? Readonly<T> : T;

export class MissingFieldError {
  constructor(
    public readonly message: string,
    public readonly path: (string | number)[],
    public readonly query: DocumentNode,
    public readonly variables: Record<string, any>,
  ) {}
}
