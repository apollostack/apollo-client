---
title: Reading and writing data to the cache
sidebar_title: Reading and writing
---

You can read and write data directly to the Apollo Client cache, _without_ communicating with your GraphQL server. You can interact with data that you previously fetched from your server, _and_ with data that's only available [locally](../local-state/local-state-management/).

Apollo Client supports multiple strategies for interacting with cached data:

| Strategy | API | Description |
|----------|-----|-------------|
| [Using GraphQL queries](#using-graphql-queries) | `readQuery` / `writeQuery` | Enables you to use standard GraphQL queries for managing both remote and local data. |
| [Using GraphQL fragments](#using-graphql-fragments) | `readFragment` / `writeFragment` | Enables you to access the fields of any cached object without composing an entire query to reach that object.  |
| [Directly modifying cached fields](#using-cachemodify) | `cache.modify` | Enables you to manipulate cached data without using GraphQL at all. |

 You can use whichever combination of strategies and methods are most helpful for your use case.

> All code samples below assume that you have initialized an instance of `ApolloClient` and that you have imported the `gql` function from `@apollo/client`. If you haven't, [get started](../get-started).
>
>In a React component, you can access your instance of `ApolloClient` using [`ApolloProvider`](https://www.apollographql.com/docs/react/api/react/hooks/#the-apolloprovider-component) and the [`useApolloClient`](https://www.apollographql.com/docs/react/api/react/hooks/#useapolloclient) hook.

## Using GraphQL queries

You can read and write cache data using GraphQL queries that are similar (or even identical) to queries that you execute on your server:

### `readQuery`

The `readQuery` method enables you to execute a GraphQL query directly on your cache, like so:

```js{12-17}
const READ_TODO = gql`
  query ReadTodo($id: ID!) {
    todo(id: $id) {
      id
      text
      completed
    }
  }
`;

// Fetch the cached to-do item with ID 5
const { todo } = client.readQuery({
  query: READ_TODO,
  variables: { // Provide any required variables here
    id: 5,
  },
});
```

If your cache contains data for _all_ of the query's fields, `readQuery` returns an object that matches the shape of the query:

```js
{
  todo: {
    __typename: 'Todo', // __typename is automatically included
    id: 5,
    text: 'Buy oranges 🍊',
    completed: true
  }
}
```

> Apollo Client automatically queries for every object's `__typename`, even if you don't include this field in your query string.

**Do not modify the returned object directly.** The same object might be returned to multiple components. To update data in the cache, instead create a replacement object and pass it to [`writeQuery`](#writequery).

If the cache is missing data for _any_ of the query's fields, `readQuery` returns `null`. It does _not_ attempt to fetch data from your GraphQL server.

The query you provide `readQuery` can include fields that are _not_ defined in your GraphQL server's schema (i.e., [local-only fields](../local-state/managing-state-with-field-policies/)).

> Prior to Apollo Client 3.3, `readQuery` threw a `MissingFieldError` exception to report missing fields. Beginning with Apollo Client 3.3, `readQuery` always returns `null` to indicate that fields are missing.

### `writeQuery`

The `writeQuery` method enables you to write data to your cache in a shape that matches a GraphQL query. It resembles `readQuery`, except that it requires a `data` option:

```js
client.writeQuery({
  query: gql`
    query WriteTodo($id: Int!) {
      todo(id: $id) {
        id
        text
        completed
      }
    }`,
  data: { // Contains the data to write
    todo: {
      __typename: 'Todo',
      id: 5,
      text: 'Buy grapes 🍇',
      completed: false
    },
  },
  variables: {
    id: 5
  }
});
```

This example creates (or edits) a cached `Todo` object with ID `5`.

Note the following about `writeQuery`:

* Any changes you make to cached data with `writeQuery` are **not** pushed to your GraphQL server. If you reload your environment, these changes disappear.
* The shape of your query is _not_ enforced by your GraphQL server's schema:
    * The query can include fields that are _not_ present in your schema.
    * You can (but usually shouldn't) provide values for schema fields that are _invalid_ according to your schema.

#### Editing existing data 

In the example above, if your cache _already_ contains a `Todo` object with ID `5`, `writeQuery` overwrites the fields that are included in `data` (other fields are preserved):

```js{6-7,17-18}
// BEFORE
{ 
  'Todo:5': {
    __typename: 'Todo',
    id: 5,
    text: 'Buy oranges 🍊',
    completed: true,
    dueDate: '2022-07-02'
  }
}

// AFTER
{ 
  'Todo:5': {
    __typename: 'Todo',
    id: 5,
    text: 'Buy grapes 🍇',
    completed: false,
    dueDate: '2022-07-02'
  }
}
```

> If you include a field in `query` but don't include a _value_ for it in `data`, the field's current cached value is preserved.

## Using GraphQL fragments

You can read and write cache data using GraphQL fragments on _any_ normalized cache object. This provides more "random access" to your cached data than `readQuery`/`writeQuery`, which require a complete valid query.

### `readFragment`

This example fetches the same data as [the example for `readQuery`](#readquery) using `readFragment` instead:

```js
const todo = client.readFragment({
  id: 'Todo:5', // The value of the to-do item's unique identifier
  fragment: gql`
    fragment MyTodo on Todo {
      id
      text
      completed
    }
  `,
});
```

Unlike `readQuery`, `readFragment` requires an `id` option. This option specifies the unique identifier for the object in your cache. [By default](cache-configuration/#default-identifier-generation), this identifier has the format `<_typename>:<id>` (which is why we provide `Todo:5` above). You can [customize this identifier](./cache-configuration/#customizing-identifier-generation-by-type).

In the example above, `readFragment` returns `null` if no `Todo` object with ID `5` exists in the cache, or if the object exists but is missing a value for either `text` or `completed`.

> Prior to Apollo Client 3.3, `readFragment` threw `MissingFieldError` exceptions to report missing fields, and returned `null` only when reading a fragment from a nonexistent ID. Beginning with Apollo Client 3.3, `readFragment` always returns `null` to indicate insufficient data (missing ID or missing fields), instead of throwing a `MissingFieldError`.

### `writeFragment`

In addition to reading arbitrary data from the Apollo Client cache, you can _write_ arbitrary data to the cache with the `writeQuery` and `writeFragment` methods.

> **Any changes you make to cached data with `writeQuery` and `writeFragment` are  not pushed to your GraphQL server.** If you reload your environment, these changes will disappear.

These methods have the same signature as their `read` counterparts, except they require an additional `data` variable.

For example, the following call to `writeFragment` _locally_ updates the `completed` flag for a `Todo` object with an `id` of `5`:

```js
client.writeFragment({
  id: 'Todo:5',
  fragment: gql`
    fragment MyTodo on Todo {
      completed
    }
  `,
  data: {
    completed: true,
  },
});
```

All subscribers to the Apollo Client cache (including all active queries) see this change and update your application's UI accordingly.

## Combining reads and writes

You can combine `readQuery` and `writeQuery` (or `readFragment` and `writeFragment`) to fetch currently cached data and make selective modifications to it. The example below creates a new `Todo` item and adds it to your cached to-do list. Remember, this addition is _not_ sent to your remote server.

```js
// Query that fetches all existing to-do items
const query = gql`
  query MyTodoAppQuery {
    todos {
      id
      text
      completed
    }
  }
`;

// Get the current to-do list
const data = client.readQuery({ query });

// Create a new to-do item
const myNewTodo = {
  id: '6',
  text: 'Start using Apollo Client.',
  completed: false,
  __typename: 'Todo',
};

// Write back to the to-do list, appending the new item
client.writeQuery({
  query,
  data: {
    todos: [...data.todos, myNewTodo],
  },
});
```

## Using `cache.modify`

The `modify` method of `InMemoryCache` enables you to directly modify the values of individual cached fields, or even delete fields entirely.

* Like `writeQuery` and `writeFragment`, `modify` triggers a refresh of all active queries that depend on modified fields (unless you override this behavior by passing `broadcast: false`).
* _Unlike_ `writeQuery` and `writeFragment`:
    * `modify` circumvents any [`merge` functions](cache-field-behavior/#the-merge-function) you've defined, which means that fields are always overwritten with exactly the values you specify.
    * `modify` _cannot_ write fields that do not already exist in the cache.
* Watched queries can control what happens when they are invalidated by updates to the cache, by passing options like `fetchPolicy` and `nextFetchPolicy` to [`client.watchQuery`](../api/core/ApolloClient/#ApolloClient.watchQuery) or the [`useQuery`](../api/react/hooks/#options) hook.

### Parameters

Canonically documented in the [API reference](../api/cache/InMemoryCache/#modify), the `modify` method takes the following parameters:

* The ID of a cached object to modify (which we recommend obtaining with [`cache.identify`](#obtaining-an-objects-custom-id))
* A map of **modifier functions** to execute (one for each field to modify)
* Optional `broadcast` and `optimistic` boolean values to customize behavior

A modifier function applies to a single field. It takes its associated field's current cached value as a parameter and returns whatever value should replace it.

Here's an example call to `modify` that modifies a `name` field to convert its value to upper case:

```js
cache.modify({
  id: cache.identify(myObject),
  fields: {
    name(cachedName) {
      return cachedName.toUpperCase();
    },
  },
  /* broadcast: false // Include this to prevent automatic query refresh */
});
```

> If you don't provide a modifier function for a particular field, that field's cached value remains unchanged.

#### Values vs. references

When you define a modifier function for a field that contains a scalar, an enum, or a list of these base types, the modifier function is passed the exact existing value for the field. For example, if you define a modifier function for an object's `quantity` field that has current value `5`, your modifier function is passed the value `5`.

**However**, when you define a modifier function for a field that contains an object type or a list of objects, those objects are represented as **references**. Each reference points to its corresponding object in the cache by its identifier. If you return a _different_ reference in your modifier function, you change _which_ other cached object is contained in this field. You _don't_ modify the original cached object's data.

### Modifier function utilities

A modifier function can optionally take a second parameter, which is an object that contains several helpful utilities.

A couple of these utilities (the `readField` function and the `DELETE` sentinel object) are used in the examples below. For descriptions of all available utilities, see the [API reference](../api/cache/InMemoryCache/#modifier-function-api).

### Example: Removing an item from a list

Let's say we have a blog application where each `Post` has an array of `Comment`s. Here's how we might remove a specific `Comment` from a paginated `Post.comments` array:

```js
const idToRemove = 'abc123';

cache.modify({
  id: cache.identify(myPost),
  fields: {
    comments(existingCommentRefs, { readField }) {
      return existingCommentRefs.filter(
        commentRef => idToRemove !== readField('id', commentRef)
      );
    },
  },
});
```

Let's break this down:

* In the `id` field, we use [`cache.identify`](#obtaining-an-objects-custom-id) to obtain the identifier of the cached `Post` object we want to remove a comment from.

* In the `fields` field, we provide an object that lists our modifier functions. In this case, we define a single modifier function (for the `comments` field).

* The `comments` modifier function takes our existing cached array of comments as a parameter (`existingCommentRefs`). It also uses the `readField` utility function, which helps you read the value of any cached field.

* The modifier function returns an array that filters out all comments with an ID that matches `idToRemove`. The returned array replaces the existing array in the cache.

### Example: Adding an item to a list

Now let's look at _adding_ a `Comment` to a `Post`:

```js
const newComment = {
  __typename: 'Comment',
  id: 'abc123',
  text: 'Great blog post!',
};

cache.modify({
  id: cache.identify(myPost),
  fields: {
    comments(existingCommentRefs = [], { readField }) {
      const newCommentRef = cache.writeFragment({
        data: newComment,
        fragment: gql`
          fragment NewComment on Comment {
            id
            text
          }
        `
      });

      // Quick safety check - if the new comment is already
      // present in the cache, we don't need to add it again.
      if (existingCommentRefs.some(
        ref => readField('id', ref) === newComment.id
      )) {
        return existingCommentRefs;
      }

      return [...existingCommentRefs, newCommentRef];
    }
  }
});
```

When the `comments` field modifier function is called, it first calls `writeFragment` to store our `newComment` data in the cache. The `writeFragment` function returns a reference (`newCommentRef`) that points to the newly cached comment.

As a safety check, we then scan the array of existing comment references (`existingCommentRefs`) to make sure that our new isn't already in the list. If it isn't, we add the new comment reference to the list of references, returning the full list to be stored in the cache.

### Example: Updating the cache after a mutation

If you call `writeFragment` with an `options.data` object that the cache is able to identify, based on its `__typename` and primary key fields, you can avoid passing `options.id` to `writeFragment`.

Whether you provide `options.id` explicitly or let `writeFragment` figure it out using `options.data`, `writeFragment` returns a `Reference` to the identified object.

This behavior makes `writeFragment` a good tool for obtaining a `Reference` to an existing object in the cache, which can come in handy when writing an `update` function for [`useMutation`](../data/mutations/):

For example:

```js
const [addComment] = useMutation(ADD_COMMENT, {
  update(cache, { data: { addComment } }) {
    cache.modify({
      id: cache.identify(myPost),
      fields: {
        comments(existingCommentRefs = [], { readField }) {
          const newCommentRef = cache.writeFragment({
            data: addComment,
            fragment: gql`
              fragment NewComment on Comment {
                id
                text
              }
            `
          });
          return [...existingCommentRefs, newCommentRef];
        }
      }
    });
  }
});
```

In this example, `useMutation` automatically creates a `Comment` and adds it to the cache, but it _doesn't_ automatically know how to add that `Comment` to the corresponding `Post`'s list of `comments`. This means that any queries watching the `Post`'s list of `comments` _won't_ update.

To address this, we use the [`update` callback](../data/mutations/#updating-the-cache-after-a-mutation) of `useMutation` to call `cache.modify`. Like the [previous example](#example-adding-an-item-to-a-list), we add the new comment to the list. _Unlike_ the previous example, the comment was already added to the cache by `useMutation`. Consequently, `cache.writeFragment` returns a reference to the existing object.

### Example: Deleting a field from a cached object

A modifier function's optional second parameter is an object that includes [several helpful utilities](#modifier-function-utilities), such as the `canRead` and `isReference` functions. It also includes a sentinel object called `DELETE`.

To delete a field from a particular cached object, return the `DELETE` sentinel object from the field's modifier function, like so:

```js
cache.modify({
  id: cache.identify(myPost),
  fields: {
    comments(existingCommentRefs, { DELETE }) {
      return DELETE;
    },
  },
});
```

### Example: Invalidating fields within a cached object

Normally, changing or deleting a field's value also _invalidates_ the field, causing watched queries to be reread if they previously consumed the field.

Using `cache.modify`, it's also possible to invalidate the field without changing or deleting its value, by returning the `INVALIDATE` sentinel:

```js
cache.modify({
  id: cache.identify(myPost),
  fields: {
    comments(existingCommentRefs, { INVALIDATE }) {
      return INVALIDATE;
    },
  },
});
```

If you need to invalidate all fields within the given object, you can pass a modifier function as the value of the `fields` option:

```js
cache.modify({
  id: cache.identify(myPost),
  fields(fieldValue, details) {
    return details.INVALIDATE;
  },
});
```

When using this form of `cache.modify`, you can determine the individual field names using `details.fieldName`. This technique works for any modifier function, not just those that return `INVALIDATE`.

## Obtaining an object's custom ID

If a type in your cache uses a [custom identifier](./cache-configuration/#customizing-identifier-generation-by-type) (or even if it doesn't), you can use the `cache.identify` method to obtain the identifier for an object of that type. This method takes an object and computes its ID based on both its `__typename` and its identifier field(s). This means you don't have to keep track of which fields make up each type's identifier.

### Example

Let's say we have a JavaScript representation of a cached GraphQL object, like this:

```js{3}
const invisibleManBook = {
  __typename: 'Book',
  isbn: '9780679601395', // This type's custom identifier
  title: 'Invisible Man',
  author: {
    __typename: 'Author',
    name: 'Ralph Ellison',
  },
};
```

If we want to interact with this object in our cache with methods like [`writeFragment`](#writefragment) or [`cache.modify`](#using-cachemodify), we need the object's identifier. Our `Book` type's identifier appears to be custom, because the `id` field isn't present.

Instead of needing to look up that our `Book` type uses the `isbn` field as its identifier, we can use the `cache.identify` method, like so:

```js{8}
const bookYearFragment = gql`
  fragment BookYear on Book {
    publicationYear
  }
`;

const fragmentResult = cache.writeFragment({
  id: cache.identify(invisibleManBook),
  fragment: bookYearFragment,
  data: {
    publicationYear: '1952'
  }
});
```

The cache knows that the `Book` type uses the `isbn` field for its identifier, so `cache.identify` can correctly populate the `id` field above.

This example is straightforward because our custom identifier uses a single field (`isbn`). But custom identifiers can consist of _multiple_ fields (such as both `isbn` _and_ `title`). This makes it much more challenging and repetitive to specify an object's custom ID _without_ using `cache.identify`.
