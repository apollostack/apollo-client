---
title: Customizing the behavior of cached fields
sidebar_title: Customizing field behavior
---

You can customize how a particular field in your Apollo Client cache is read and written. To do so, you define a **field policy** for the field. A field policy can include:

* A [`read` function](#the-read-function) that specifies what happens when the field's cached value is read
* A [`merge` function](#the-merge-function) that specifies what happens when field's cached value is written
* An array of [key arguments](#specifying-key-arguments) that help the cache avoid storing unnecessary duplicate data.

You provide field policies to the constructor of `InMemoryCache`. Each field policy is defined inside whatever [`TypePolicy` object](./cache-configuration/#typepolicy-fields)  corresponds to the type that contains the field. The following example defines a field policy for the `name` field of a `Person` type: 

```ts{5-10}
const cache = new InMemoryCache({
  typePolicies: {
    Person: {
      fields: {
        name: {
          read(name) {
            // Return the cached name, transformed to upper case
            return name.toUpperCase();
          }
        }
      },
    },
  },
});
```

The field policy above defines a [`read` function](#the-read-function) that specifies what the cache returns whenever `Person.name` is queried.

## The `read` function

If you define a `read` function for a field, the cache calls that function whenever your client queries for the field. In the query response, the field is populated with the `read` function's return value, _instead of the field's cached value_.

The first parameter of a `read` function provides the field's currently cached value, if one exists. You can use this to help determine the function's return value.

The second parameter is an object that provides access to several properties and helper functions, which are explained in the [`FieldPolicy` API reference](#fieldpolicy-api-reference).

The following `read` function assigns a default value of `UNKNOWN NAME` to the `name` field of a `Person` type, if the actual value is not available in the cache. In all other cases, the cached value is returned.

```ts
const cache = new InMemoryCache({
  typePolicies: {
    Person: {
      fields: {
        name: {
          read(name = "UNKNOWN NAME") {
            return name;
          }
        },
      },
    },
  },
});
```

If a field requires numerous parameters then each parameter must be wrapped in a variable that is then destructured and returned. 
Each parameter will be available as individual sub-fields.

The following `read` function assigns a default value of `UNKNOWN FIRST_NAME` to the `first_name` sub-field of a `fullName` field and a `UNKNOWN LAST_NAME` to the `last_name` of a `fullName` field.

```ts
const cache = new InMemoryCache({
  typePolicies: {
    Person: {
      fields: {
        fullName: {
          read(full_name = { first_name:  "UNKNOWN FIRST_NAME", last_name: "UNKNOWN LAST_NAME" }) {
            return { ...full_name };
          }
        },
      },
    },
  },
});
```

The following `query` returns the `first_name` and `last_name` sub-fields from the `fullName` field. 

```graphql
query personWithFullName {
  fullName {
    first_name
    last_name
  }
}

```

If a field accepts arguments, the second parameter includes the values of those arguments. The following `read` function checks to see if the `maxLength` argument is provided when the `name` field is queried. If it is, the function returns only the first `maxLength` characters of the person's name. Otherwise, the person's full name is returned.

```ts
const cache = new InMemoryCache({
  typePolicies: {
    Person: {
      fields: {
        // If a field's TypePolicy would only include a read function,
        // you can optionally define the function like so, instead of
        // nesting it inside an object as shown in the example above.
        name(name: string, { args }) {
          if (args && typeof args.maxLength === "number") {
            return name.substring(0, args.maxLength);
          }
          return name;
        },
      },
    },
  },
});
```

You can define a `read` function for a field that isn't even defined in your schema. For example, the following `read` function enables you to query a `userId` field that is always populated with locally stored data:

```ts
const cache = new InMemoryCache({
  typePolicies: {
    Person: {
      fields: {
        userId() {
          return localStorage.loggedInUserId;
        },
      },
    },
  },
});
```

> Note that to query for a field that is only defined locally, your query should [include the `@client` directive](../local-state/managing-state-with-field-policies#querying) on that field so that Apollo Client doesn't include it in requests to your GraphQL server.

Other use cases for a `read` function include:

* Transforming cached data to suit your client's needs, such as rounding floating-point values to the nearest integer
* Deriving local-only fields from one or more schema fields on the same object (such as deriving an `age` field from a `birthDate` field)
* Deriving local-only fields from one or more schema fields across _multiple_ objects

For a full list of the options provided to the `read` function, see the [API reference](#fieldpolicy-api-reference). You will almost never need to use all of these options, but each one has an important role when reading fields from the cache.

## The `merge` function

If you define a `merge` function for a field, the cache calls that function whenever the field is about to be written with an incoming value (such as from your GraphQL server). When the write occurs, the field's new value is set to the `merge` function's return value, _instead of the original incoming value_.

### Merging arrays

A common use case for a `merge` function is to define how to write to a field that holds an array. By default, the field's existing array is _completely replaced_ by the incoming array. Often, it's preferable to _concatenate_ the two arrays instead, like so:

```ts
const cache = new InMemoryCache({
  typePolicies: {
    Agenda: {
      fields: {
        tasks: {
          merge(existing = [], incoming: any[]) {
            return [...existing, ...incoming];
          },
        },
      },
    },
  },
});
```

Note that `existing` is undefined the very first time this function is called for a given instance of the field, because the cache does not yet contain any data for the field. Providing the `existing = []` default parameter is a convenient way to handle this case.

> Your `merge` function **cannot** push the `incoming` array directly onto the `existing` array. It must instead return a new array to prevent potential errors. In development mode, Apollo Client prevents unintended modification of the `existing` data with `Object.freeze`.

### Merging non-normalized objects

Another common use case for custom field `merge` functions is to combine nested objects that do not have IDs, but are known (by you, the application developer) to represent the same logical object, assuming the parent object is the same.

Suppose that a `Book` type has an `author` field, which is an object containing information like the author's `name`, `language`, and `dateOfBirth`. The `Book` object has `__typename: "Book"` and a unique `isbn` field, so the cache can tell when two `Book` result objects represent the same logical entity. However, for whatever reason, the query that retrieved this `Book` did not ask for enough information about the `book.author` object. Perhaps no `keyFields` were specified for the `Author` type, and there is no default `id` field.

This lack of identifying information poses a problem for the cache, because it cannot determine automatically whether two `Author` result objects are the same. If multiple queries ask for different information about the author of this `Book`, the order of the queries matters, because the `favoriteBook.author` object from the second query cannot be safely merged with the `favoriteBook.author` object from the first query, and vice-versa:

```graphql
query BookWithAuthorName {
  favoriteBook {
    isbn
    title
    author {
      name
    }
  }
}

query BookWithAuthorLanguage {
  favoriteBook {
    isbn
    title
    author {
      language
    }
  }
}
```

In such situations, the cache defaults to _replacing_ the existing `favoriteBook.author` data with the incoming data, without merging the `name` and `language` fields together, because the risk of merging inconsistent `name` and `language` fields from different authors is unacceptable.

> Note: Apollo Client 2.x would sometimes merge unidentified objects. While this behavior might accidentally have aligned with the intentions of the developer, it led to subtle inconsistencies within the cache. Apollo Client 3.0 refuses to perform unsafe merges, and instead warns about potential loss of unidentified data.

You could fix this problem by modifying your queries to request an `id` field for the `favoriteBook.author` objects, or by specifying custom `keyFields` in the `Author` type policy, such as `["name", "dateOfBirth"]`. Providing the cache with this information allows it to know when two `Author` objects represent the same logical entity, so it can safely merge their fields. This solution is recommended, when feasible.

However, you may encounter situations where your data graph does not provide any uniquely identifying fields for `Author` objects. In these rare scenarios, it might be safe to assume that a given `Book` has one and only one primary `Author`, and the author never changes. In other words, the identity of the author is implied by the identity of the book. This common-sense knowledge is something you have at your disposal, as a human, but it must be communicated to the cache, which is neither human nor capable of telepathy.

In such situations, you can define a custom `merge` function for the `author` field within the type policy for `Book`:

```ts
const cache = new InMemoryCache({
  typePolicies: {
    Book: {
      fields: {
        author: {
          merge(existing, incoming) {
            // Better, but not quite correct.
            return { ...existing, ...incoming };
          },
        },
      },
    },
  },
});
```

Alternatively, if you prefer to keep the default behavior of completely replacing the `existing` data with the `incoming` data, while also silencing the warnings, the following `merge` function will explicitly permit replacement:

```ts
const cache = new InMemoryCache({
  typePolicies: {
    Book: {
      fields: {
        author: {
          merge(existing, incoming) {
            // Equivalent to what happens if there is no custom merge function.
            return incoming;
          },
        },
      },
    },
  },
});
```

Since writing this kind of `merge` function can become repetitive, the following shorthand will provide the same behavior:

```ts
const cache = new InMemoryCache({
  typePolicies: {
    Book: {
      fields: {
        author: {
          // Short for always preferring incoming over existing data.
          merge: false,
        },
      },
    },
  },
});
```

When you use `{ ...existing, ...incoming }`, `Author` objects with differing fields (`name`, `dateOfBirth`) can be combined without losing fields, which is definitely an improvement over blind replacement.

But what if the `Author` type defines its own custom `merge` functions for fields of the `incoming` object? Since we're using [object spread syntax](https://2ality.com/2016/10/rest-spread-properties.html), such fields will immediately overwrite fields in `existing`, without triggering any nested `merge` functions. The `{ ...existing, ...incoming }` syntax may be an improvement, but it is not fully correct.

Fortunately, you can find a helper function called `options.mergeObjects` in the options passed to the `merge` function, which generally behaves the same as `{ ...existing, ...incoming }`, except when the `incoming` fields have custom `merge` functions. When `options.mergeObjects` encounters custom `merge` functions for any of the fields in its second argument (`incoming`), those nested `merge` functions will be called before combining the fields of `existing` and `incoming`, as desired:

```ts
const cache = new InMemoryCache({
  typePolicies: {
    Book: {
      fields: {
        author: {
          merge(existing, incoming, { mergeObjects }) {
            // Correct, thanks to invoking nested merge functions.
            return mergeObjects(existing, incoming);
          },
        },
      },
    },
  },
});
```

Because this `Book.author` field policy has no `Book`- or `Author`-specific logic in it, you can reuse this `merge` function for any field that needs this kind of handling.

Since writing this kind of `merge` function can become repetitive, the following shorthand will provide the same behavior:

```ts
const cache = new InMemoryCache({
  typePolicies: {
    Book: {
      fields: {
        author: {
          // Short for options.mergeObjects(existing, incoming).
          merge: true,
        },
      },
    },
  },
});
```

In summary, the `Book.author` policy above allows the cache to safely merge the `author` objects of any two `Book` objects that have the same identity.

### Merging arrays of non-normalized objects

Once you're comfortable with the ideas and recommendations from the previous section, consider what happens when a `Book` can have multiple authors:

```graphql
query BookWithAuthorNames {
  favoriteBook {
    isbn
    title
    authors {
      name
    }
  }
}

query BookWithAuthorLanguages {
  favoriteBook {
    isbn
    title
    authors {
      language
    }
  }
}
```

In this case, the `favoriteBook.authors` field is no longer just a single object, but an array of authors, so it's even more imporant to define a custom `merge` function to prevent loss of data by replacement:

```ts
const cache = new InMemoryCache({
  typePolicies: {
    Book: {
      fields: {
        authors: {
          merge(existing: any[], incoming: any[], { readField, mergeObjects }) {
            const merged: any[] = existing ? existing.slice(0) : [];
            const authorNameToIndex: Record<string, number> = Object.create(null);
            if (existing) {
              existing.forEach((author, index) => {
                authorNameToIndex[readField<string>("name", author)] = index;
              });
            }
            incoming.forEach(author => {
              const name = readField<string>("name", author);
              const index = authorNameToIndex[name];
              if (typeof index === "number") {
                // Merge the new author data with the existing author data.
                merged[index] = mergeObjects(merged[index], author);
              } else {
                // First time we've seen this author in this array.
                authorNameToIndex[name] = merged.length;
                merged.push(author);
              }
            });
            return merged;
          },
        },
      },
    },
  },
});
```

Instead of blindly replacing the existing `authors` array with the incoming array, this code concatenates the arrays together, while also checking for duplicate author names, merging the fields of any repeated `author` objects.

The `readField` helper function is more robust than using `author.name`, because it also tolerates the possibility that the `author` is a `Reference` object referring to data elsewhere in the cache, which could happen if you (or someone else on your team) eventually gets around to specifying `keyFields` for the `Author` type.

As this example suggests, `merge` functions can become quite sophisticated. When this happens, you can often extract the generic logic into a reusable helper function:

```ts
const cache = new InMemoryCache({
  typePolicies: {
    Book: {
      fields: {
        authors: {
          merge: mergeArrayByField<AuthorType>("name"),
        },
      },
    },
  },
});
```

Now that you've hidden the details behind a reusable abstraction, it no longer matters how complicated the implementation gets. This is liberating, because it allows you to improve your client-side business logic over time, while keeping related logic consistent across your entire application.

### Handling pagination

When a field holds an array, it's often useful to [paginate](/data/pagination/) that array's results, because the total result set can be arbitrarily large.

Typically, a query includes pagination arguments that specify:

* Where to start in the array, using either a numeric offset or a starting ID
* The maximum number of elements to return in a single "page"

If you implement pagination for a field, it's important to keep pagination arguments in mind if you then implement `read` and `merge` functions for the field:

```ts
const cache = new InMemoryCache({
  typePolicies: {
    Agenda: {
      fields: {
        tasks: {
          merge(existing: any[], incoming: any[], { args }) {
            const merged = existing ? existing.slice(0) : [];
            // Insert the incoming elements in the right places, according to args.
            const end = args.offset + Math.min(args.limit, incoming.length);
            for (let i = args.offset; i < end; ++i) {
              merged[i] = incoming[i - args.offset];
            }
            return merged;
          },

          read(existing: any[], { args }) {
            // If we read the field before any data has been written to the
            // cache, this function will return undefined, which correctly
            // indicates that the field is missing.
            const page = existing && existing.slice(
              args.offset,
              args.offset + args.limit,
            );
            // If we ask for a page outside the bounds of the existing array,
            // page.length will be 0, and we should return undefined instead of
            // the empty array.
            if (page && page.length > 0) {
              return page;
            }
          },
        },
      },
    },
  },
});
```

As this example shows, your `read` function often needs to cooperate with your `merge` function, by handling the same arguments in the inverse direction.

If you want a given "page" to start after a specific entity ID instead of starting from `args.offset`, you can implement your `merge` and `read` functions as follows, using the `readField` helper function to examine existing task IDs:

```ts
const cache = new InMemoryCache({
  typePolicies: {
    Agenda: {
      fields: {
        tasks: {
          merge(existing: any[], incoming: any[], { args, readField }) {
            const merged = existing ? existing.slice(0) : [];
            // Obtain a Set of all existing task IDs.
            const existingIdSet = new Set(
              merged.map(task => readField("id", task)));
            // Remove incoming tasks already present in the existing data.
            incoming = incoming.filter(
              task => !existingIdSet.has(readField("id", task)));
            // Find the index of the task just before the incoming page of tasks.
            const afterIndex = merged.findIndex(
              task => args.afterId === readField("id", task));
            if (afterIndex >= 0) {
              // If we found afterIndex, insert incoming after that index.
              merged.splice(afterIndex + 1, 0, ...incoming);
            } else {
              // Otherwise insert incoming at the end of the existing data.
              merged.push(...incoming);
            }
            return merged;
          },

          read(existing: any[], { args, readField }) {
            if (existing) {
              const afterIndex = existing.findIndex(
                task => args.afterId === readField("id", task));
              if (afterIndex >= 0) {
                const page = existing.slice(
                  afterIndex + 1,
                  afterIndex + 1 + args.limit,
                );
                if (page && page.length > 0) {
                  return page;
                }
              }
            }
          },
        },
      },
    },
  },
});
```

Note that if you call `readField(fieldName)`, it returns the value of the specified field from the current object. If you pass an object as a _second_ argument to `readField`, (e.g., `readField("id", task)`), `readField` instead reads the specified field from the specified object. In the above example, reading the `id` field from existing `Task` objects allows us to deduplicate the `incoming` task data.

The pagination code above is complicated, but after you implement your preferred pagination strategy, you can reuse it for every field that uses that strategy, regardless of the field's type. For example:

```ts
function afterIdLimitPaginatedFieldPolicy<T>() {
  return {
    merge(existing: T[], incoming: T[], { args, readField }): T[] {
      ...
    },
    read(existing: T[], { args, readField }): T[] {
      ...
    },
  };
}

const cache = new InMemoryCache({
  typePolicies: {
    Agenda: {
      fields: {
        tasks: afterIdLimitPaginatedFieldPolicy<Reference>(),
      },
    },
  },
});
```

## Specifying key arguments

If a field accepts arguments, you can specify an array of `keyArgs` in the field's `FieldPolicy`. This array indicates which arguments are **key arguments** that are used to calculate the field's value. Specifying this array can help reduce the amount of duplicate data in your cache.

### Example

Let's say your schema's `Query` type includes a `monthForNumber` field. This field returns the details of particular month, given a provided `number` argument (January for `1` and so on). The `number` argument is a key argument for this field, because it is used when calculating the field's result:

```ts
const cache = new InMemoryCache({
  typePolicies: {
    Query: {
      fields: {
        monthForNumber: {
          keyArgs: ["number"],
        },
      },
    },
  },
});
```

An example of a _non-key_ argument is an access token, which is used to authorize a query but _not_ to calculate its result. If `monthForNumber` also accepts an `accessToken` argument, the value of that argument does _not_ affect which month's details are returned.

By default, the cache stores a separate value for _every unique combination of argument values you provide when querying a particular field_. When you specify a field's key arguments, the cache understands that any _non_-key arguments don't affect that field's value. Consequently, if you execute two different queries with the `monthForNumber` field, passing the _same_ `number` argument but _different_ `accessToken` arguments, the second query response will overwrite the first, because both invocations use the exact same value for all key arguments.

If you need more control over the behavior of `keyArgs`, you can pass a function instead of an array. This `keyArgs` function will receive the arguments object as its first parameter, and a `context` object providing other relevant details as its second parameter. See `KeyArgsFunction` in the types below for further information.

## `FieldPolicy` API reference

Here are the definitions for the `FieldPolicy` type and its related types:

```ts
// These generic type parameters will be inferred from the provided policy in
// most cases, though you can use this type to constrain them more precisely.
type FieldPolicy<
  TExisting,
  TIncoming = TExisting,
  TReadResult = TExisting,
> = {
  keyArgs?: KeySpecifier | KeyArgsFunction | false;
  read?: FieldReadFunction<TExisting, TReadResult>;
  merge?: FieldMergeFunction<TExisting, TIncoming> | boolean;
};

type KeySpecifier = (string | KeySpecifier)[];

type KeyArgsFunction = (
  args: Record<string, any> | null,
  context: {
    typename: string;
    fieldName: string;
    field: FieldNode | null;
    variables?: Record<string, any>;
  },
) => string | KeySpecifier | null | void;

type FieldReadFunction<TExisting, TReadResult = TExisting> = (
  existing: Readonly<TExisting> | undefined,
  options: FieldFunctionOptions,
) => TReadResult;

type FieldMergeFunction<TExisting, TIncoming = TExisting> = (
  existing: Readonly<TExisting> | undefined,
  incoming: Readonly<TIncoming>,
  options: FieldFunctionOptions,
) => TExisting;

// These options are common to both read and merge functions:
interface FieldFunctionOptions {
  cache: InMemoryCache;

  // The final argument values passed to the field, after applying variables.
  // If no arguments were provided, this property will be null.
  args: Record<string, any> | null;

  // The name of the field, equal to options.field.name.value when
  // options.field is available. Useful if you reuse the same function for
  // multiple fields, and you need to know which field you're currently
  // processing. Always a string, even when options.field is null.
  fieldName: string;

  // The FieldNode object used to read this field. Useful if you need to
  // know about other attributes of the field, such as its directives. This
  // option will be null when a string was passed to options.readField.
  field: FieldNode | null;

  // The variables that were provided when reading the query that contained
  // this field. Possibly undefined, if no variables were provided.
  variables?: Record<string, any>;

  // Easily detect { __ref: string } reference objects.
  isReference(obj: any): obj is Reference;

  // Returns a Reference object if obj can be identified, which requires,
  // at minimum, a __typename and any necessary key fields. If true is
  // passed for the optional mergeIntoStore argument, the object's fields
  // will also be persisted into the cache, which can be useful to ensure
  // the Reference actually refers to data stored in the cache. If you
  // pass an ID string, toReference will make a Reference out of it. If
  // you pass a Reference, toReference will return it as-is.
  toReference(
    objOrIdOrRef: StoreObject | string | Reference,
    mergeIntoStore?: boolean,
  ): Reference | undefined;

  // Helper function for reading other fields within the current object.
  // If a foreign object or reference is provided, the field will be read
  // from that object instead of the current object, so this function can
  // be used (together with isReference) to examine the cache outside the
  // current object. If a FieldNode is passed instead of a string, and
  // that FieldNode has arguments, the same options.variables will be used
  // to compute the argument values. Note that this function will invoke
  // custom read functions for other fields, if defined. Always returns
  // immutable data (enforced with Object.freeze in development).
  readField<T = StoreValue>(
    nameOrField: string | FieldNode,
    foreignObjOrRef?: StoreObject | Reference,
  ): T;

  // Returns true for non-normalized StoreObjects and non-dangling
  // References, indicating that readField(name, objOrRef) has a chance of
  // working. Useful for filtering out dangling references from lists.
  canRead(value: StoreValue): boolean;

  // A handy place to put field-specific data that you want to survive
  // across multiple read function calls. Useful for field-level caching,
  // if your read function does any expensive work.
  storage: Record<string, any>;

  // Instead of just merging objects with { ...existing, ...incoming }, this
  // helper function can be used to merge objects in a way that respects any
  // custom merge functions defined for their fields.
  mergeObjects<T extends StoreObject | Reference>(
    existing: T,
    incoming: T,
  ): T | undefined;
}
```
