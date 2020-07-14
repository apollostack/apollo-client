---
title: Interacting with cached data
---

The `ApolloClient` object provides the following methods for interacting
with cached data:

* [`readQuery`](#readquery) and [`readFragment`](#readfragment)
* [`writeQuery` and `writeFragment`](#writequery-and-writefragment)
* Methods for [garbage collection and cache eviction](#garbage-collection-and-cache-eviction)


These methods are described in detail below.

> **Important:** You should call these methods on your app's `ApolloClient` object, _not_
> directly on the cache. By doing so, the `ApolloClient` object broadcasts
> cache changes to your entire app, which enables automatic UI updates. If you
> call these methods directly on the cache instead, changes are _not_ broadcast.

All code samples below assume that you have initialized an instance of  `ApolloClient` and that you have imported the `gql` function from `@apollo/client`.

## `readQuery`

The `readQuery` method enables you to run GraphQL queries directly on your
cache.

If your cache contains all of the data necessary to fulfill a specified query,
`readQuery` returns a data object in the shape of your query, just like a GraphQL
server does.

If your cache _doesn't_ contain all of the data necessary to fulfill a specified
query, `readQuery` throws an error. It _never_ attempts to fetch data from a remote
server.

Pass `readQuery` a GraphQL query string like so:

```js
const { todo } = client.readQuery({
  query: gql`
    query ReadTodo {
      todo(id: 5) {
        id
        text
        completed
      }
    }
  `,
});
```

You can provide GraphQL variables to `readQuery` like so:

```js
const { todo } = client.readQuery({
  query: gql`
    query ReadTodo($id: Int!) {
      todo(id: $id) {
        id
        text
        completed
      }
    }
  `,
  variables: {
    id: 5,
  },
});
```

> **Do not modify the return value of `readQuery`.** The same object might be
> returned to multiple components. To update data in the cache, instead create a
> replacement object and pass it to [`writeQuery`](#writequery-and-writefragment).

## `readFragment`

The `readFragment` method enables you to read data from _any_ normalized cache
object that was stored as part of _any_ query result. Unlike `readQuery`, calls to
`readFragment` do not need to conform to the structure of one of your data graph's supported queries.

Here's an example:

```js
const optimistic = true; // defaults to false, set to true if readFragment should re-run on optimic responses
const todo = client.readFragment({
  id: ..., // `id` is any id that could be returned by `dataIdFromObject`.
  fragment: gql`
    fragment MyTodo on Todo {
      id
      text
      completed
    }
  `,
}, optimistic);
```

The first argument, `id`, is the [unique identifier](cache-configuration/#generating-unique-identifiers)
that was assigned to the object you want to read from the cache. This should match
the value that your `dataIdFromObject` function assigned to the object when it was
stored.

For example, let's say you initialize `ApolloClient` like so:

```js
const client = new ApolloClient({
  ...,
  cache: new InMemoryCache({
    ...,
    dataIdFromObject: object => object.id,
  }),
});
```

If a previously executed query cached a `Todo` object with an `id` of `5`, you can
read that object from your cache with the following `readFragment` call:

```js
const todo = client.readFragment({
  id: '5',
  fragment: gql`
    fragment MyTodo on Todo {
      id
      text
      completed
    }
  `,
});
```

In the example above, if a `Todo` object with an `id` of `5` is _not_ in the cache,
`readFragment` returns `null`. If the `Todo` object _is_ in the cache but it's
missing either a `text` or `completed` field, `readFragment` throws an error.

## `writeQuery` and `writeFragment`

In addition to reading arbitrary data from the Apollo Client cache, you can
_write_ arbitrary data to the cache with the `writeQuery` and `writeFragment`
methods.

> **Any changes you make to cached data with `writeQuery` and `writeFragment` are
> not pushed to your GraphQL server.** If you reload your environment, these
> changes will disappear.

These methods have the same signature as their `read` counterparts, except they
require an additional `data` variable.

For example, the following call to `writeFragment` _locally_ updates the `completed`
flag for a `Todo` object with an `id` of `5`:

```js
client.writeFragment({
  id: '5',
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

All subscribers to the Apollo Client cache see this change and update your
application's UI accordingly.

As another example, you can combine `readQuery` and `writeQuery` to add a new `Todo`
item to your cached to-do list:

```js
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

const myNewTodo = {
  id: '6',
  text: 'Start using Apollo Client.',
  completed: false,
  __typename: 'Todo',
};

// Write back to the to-do list and include the new item
client.writeQuery({
  query,
  data: {
    todos: [...data.todos, myNewTodo],
  },
});
```

## Garbage collection and cache eviction

Apollo Client 3 enables you to selectively remove cached data that is no longer useful. The default garbage collection strategy of the `gc` method is suitable for most applications, but the `evict` method provides more fine-grained control for applications that require it.

> You call these methods directly on the `InMemoryCache` object, not on the `ApolloClient` object.

### `gc`

The `gc` method removes all objects from the normalized cache that are not **reachable**:

```js
cache.gc();
```

 To determine whether an object is reachable, the cache starts from all known root objects and uses a tracing strategy to recursively visit all available child references. Any normalized objects that are _not_ visited during this process are removed. The `cache.gc()` method returns a list of the IDs of the removed objects.

#### Configuring garbage collection

You can use the `retain` method to prevent an object (and its children) from being garbage collected, even if the object isn't reachable:

```js
cache.retain('my-object-id');
```

If you later want a `retain`ed object to be garbage collected, use the `release` method:

```js
cache.release('my-object-id');
```

If the object is unreachable, it will be garbage collected during next call to `gc`.

### `evict`

You can remove any normalized object from the cache using the `evict` method:

```js
cache.evict('my-object-id')
```

You can pass an optional second parameter to the `evict` method, that is the name of a specific field from a normalized entity that you would like to delete:

```js
cache.evict('my-object-id', 'yearOfFounding');
```

Evicting an object can often make other cached objects unreachable. Because of this, you should call the `gc` method after `evict`ing one or more objects from the cache.

## Recipes

Here are some common situations where you would need to access the cache directly. If you're manipulating the cache in an interesting way and would like your example to be featured, please send in a pull request!

### Bypassing the cache

Sometimes it makes sense to not use the cache for a specific operation. This can be done using the `no-cache` `fetchPolicy`. The `no-cache` policy does not write to the cache with the response. This may be useful for sensitive data like passwords that you don’t want to keep in the cache.

### Updating after a mutation

In some cases, just using `dataIdFromObject` is not enough for your application UI to update correctly. For example, if you want to add something to a list of objects without refetching the entire list, or if there are some objects that to which you can't assign an object identifier, Apollo Client cannot update existing queries for you. Read on to learn about the other tools at your disposal.

`refetchQueries` is the simplest way of updating the cache. With `refetchQueries` you can specify one or more queries that you want to run after a mutation is completed in order to refetch the parts of the store that may have been affected by the mutation:

```javascript
mutate({
  //... insert comment mutation
  refetchQueries: [{
    query: gql`
      query UpdateCache($repoName: String!) {
        entry(repoFullName: $repoName) {
          id
          comments {
            postedBy {
              login
              html_url
            }
            createdAt
            content
          }
        }
      }
    `,
    variables: { repoName: 'apollographql/apollo-client' },
  }],
})
```

Please note that if you call `refetchQueries` with an array of strings, then Apollo Client will look for any previously called queries that have the same names as the provided strings. It will then refetch those queries with their current variables.

A very common way of using `refetchQueries` is to import queries defined for other components to make sure that those components will be updated:

```javascript
import RepoCommentsQuery from '../queries/RepoCommentsQuery';

mutate({
  //... insert comment mutation
  refetchQueries: [{
    query: RepoCommentsQuery,
    variables: { repoFullName: 'apollographql/apollo-client' },
  }],
})
```

Using `update` gives you full control over the cache, allowing you to make changes to your data model in response to a mutation in any way you like. `update` is the recommended way of updating the cache after a query. It is explained in full [here](../api/react/hooks/#usemutation).

```jsx
import CommentAppQuery from '../queries/CommentAppQuery';

const SUBMIT_COMMENT_MUTATION = gql`
  mutation SubmitComment($repoFullName: String!, $commentContent: String!) {
    submitComment(
      repoFullName: $repoFullName
      commentContent: $commentContent
    ) {
      postedBy {
        login
        html_url
      }
      createdAt
      content
    }
  }
`;

const CommentsPageWithMutations = () => (
  <Mutation mutation={SUBMIT_COMMENT_MUTATION}>
    {mutate => {
      <AddComment
        submit={({ repoFullName, commentContent }) =>
          mutate({
            variables: { repoFullName, commentContent },
            update: (store, { data: { submitComment } }) => {
              // Read the data from our cache for this query.
              const data = store.readQuery({ query: CommentAppQuery });
              // Add our comment from the mutation to the end.
              const comments = [...data.comments, submitComment];
              // Write our data back to the cache.
              store.writeQuery({ query: CommentAppQuery, { comments }  });
            }
          })
        }
      />;
    }}
  </Mutation>
);
```

### Incremental loading: `fetchMore`

`fetchMore` can be used to update the result of a query based on the data returned by another query. Most often, it is used to handle infinite-scroll pagination or other situations where you are loading more data when you already have some.

In our GitHunt example, we have a paginated feed that displays a list of GitHub repositories. When we hit the "Load More" button, we don't want Apollo Client to throw away the repository information it has already loaded. Instead, it should just append the newly loaded repositories to the list that Apollo Client already has in the store. With this update, our UI component should re-render and show us all of the available repositories.

Let's see how to do that with the `fetchMore` method on a query:

```javascript
const FEED_QUERY = gql`
  query Feed($type: FeedType!, $offset: Int, $limit: Int) {
    currentUser {
      login
    }
    feed(type: $type, offset: $offset, limit: $limit) {
      id
      # ...
    }
  }
`;

const FeedWithData = ({ match }) => (
  <Query
    query={FEED_QUERY}
    variables={{
      type: match.params.type.toUpperCase() || "TOP",
      offset: 0,
      limit: 10
    }}
    fetchPolicy="cache-and-network"
  >
    {({ data, fetchMore }) => (
      <Feed
        entries={data.feed || []}
        onLoadMore={() =>
          fetchMore({
            variables: {
              offset: data.feed.length
            },
            updateQuery: (prev, { fetchMoreResult }) => {
              if (!fetchMoreResult) return prev;
              return Object.assign({}, prev, {
                feed: [...prev.feed, ...fetchMoreResult.feed]
              });
            }
          })
        }
      />
    )}
  </Query>
);
```


The `fetchMore` method takes a map of `variables` to be sent with the new query. Here, we're setting the offset to `feed.length` so that we fetch items that aren't already displayed on the feed. This variable map is merged with the one that's been specified for the query associated with the component. This means that other variables, e.g. the `limit` variable, will have the same value as they do within the component query.

It can also take a `query` named argument, which can be a GraphQL document containing a query that will be fetched in order to fetch more information; we refer to this as the `fetchMore` query. By default, the `fetchMore` query is the query associated with the container, in this case the `FEED_QUERY`.

When we call `fetchMore`, Apollo Client will fire the `fetchMore` query and use the logic in the `updateQuery` option to incorporate that into the original result. The named argument `updateQuery` should be a function that takes the previous result of the query associated with your component (i.e. `FEED_QUERY` in this case) and the information returned by the `fetchMore` query and return a combination of the two.

Here, the `fetchMore` query is the same as the query associated with the component. Our `updateQuery` takes the new feed items returned and just appends them onto the feed items that we'd asked for previously. With this, the UI will update and the feed will contain the next page of items!

Although `fetchMore` is often used for pagination, there are many other cases in which it is applicable. For example, suppose you have a list of items (say, a collaborative todo list) and you have a way to fetch items that have been updated after a certain time. Then, you don't have to refetch the whole todo list to get updates: you can just incorporate the newly added items with `fetchMore`, as long as your `updateQuery` function correctly merges the new results.

### The `@connection` directive

Fundamentally, paginated queries are the same as any other query with the exception that calls to `fetchMore` update the same cache key. Since these queries are cached by both the initial query and their parameters, a problem arises when later retrieving or updating paginated queries in the cache. We don’t care about pagination arguments such as limits, offsets, or cursors outside of the need to `fetchMore`, nor do we want to provide them simply for accessing cached data.

To solve this Apollo Client 1.6 introduced the `@connection` directive to specify a custom store key for results. A connection allows us to set the cache key for a field and to filter which arguments actually alter the query.

To use the `@connection` directive, simply add the directive to the segment of the query you want a custom store key for and provide the `key` parameter to specify the store key. In addition to the `key` parameter, you can also include the optional `filter` parameter, which takes an array of query argument names to include in the generated custom store key.

```js
const query = gql`
  query Feed($type: FeedType!, $offset: Int, $limit: Int) {
    feed(type: $type, offset: $offset, limit: $limit) @connection(key: "feed", filter: ["type"]) {
      ...FeedEntry
    }
  }
`
```

With the above query, even with multiple `fetchMore`s, the results of each feed update will always result in the `feed` key in the store being updated with the latest accumulated values. In this example, we also use the `@connection` directive's optional `filter` argument to include the `type` query argument in the store key, which results in multiple store values that accumulate queries from each type of feed.

Now that we have a stable store key, we can easily use `writeQuery` to perform a store update, in this case clearing out the feed.

```js
client.writeQuery({
  query: gql`
    query Feed($type: FeedType!) {
      feed(type: $type) @connection(key: "feed", filter: ["type"]) {
        id
      }
    }
  `,
  variables: {
    type: "top",
  },
  data: {
    feed: [],
  },
});
```

Note that because we are only using the `type` argument in the store key, we don't have to provide `offset` or `limit`.

### Cache redirects with `cacheRedirects`

*WARNING*: `cacheRedirects` is removed in Apollo Client v3. New documentation that outlines how to replace `cacheRedirects` with the [new cache policies API](./cache-field-behavior) is coming soon.

In some cases, a query requests data that already exists in the client store under a different key. A very common example of this is when your UI has a list view and a detail view that both use the same data. The list view might run the following query:

```graphql
query ListView {
  books {
    id
    title
    abstract
  }
}
```

When a specific book is selected, the detail view displays an individual item using this query:

```graphql
query DetailView {
  book(id: $id) {
    id
    title
    abstract
  }
}
```

> Note: The data returned by the list query has to include all the data the specific query needs. If the specific book query fetches a field that the list query doesn't return Apollo Client cannot return the data from the cache.

We know that the data is most likely already in the client cache, but because it's requested with a different query, Apollo Client doesn't know that. In order to tell Apollo Client where to look for the data, we can define custom resolvers:

```js
import { InMemoryCache } from '@apollo/client';

const cache = new InMemoryCache({
  cacheRedirects: {
    Query: {
      book: (_, args, { getCacheKey }) =>
        getCacheKey({ __typename: 'Book', id: args.id })
    },
  },
});
```

> Note: This'll also work with custom `dataIdFromObject` methods as long as you use the same one.

Apollo Client will use the ID returned by the custom resolver to look up the item in its cache. `getCacheKey` is passed inside the third argument to the resolver to generate the key of the object based on its `__typename` and `id`.

To figure out what you should put in the `__typename` property run one of the queries in GraphiQL and get the `__typename` field:

```graphql
query ListView {
  books {
    __typename
  }
}

# or

query DetailView {
  book(id: $id) {
    __typename
  }
}
```

The value that's returned (the name of your type) is what you need to put into the `__typename` property.

It is also possible to return a list of IDs:

```js
cacheRedirects: {
  Query: {
    books: (_, args, { getCacheKey }) =>
      args.ids.map(id =>
        getCacheKey({ __typename: 'Book', id: id }))
  }
}
```

### Resetting the store

Sometimes, you may want to reset the store entirely, such as [when a user logs out](../networking/authentication/#reset-store-on-logout). To accomplish this, use `client.resetStore` to clear out your Apollo cache. Since `client.resetStore` also refetches any of your active queries for you, it is asynchronous.

```js
export default withApollo(graphql(PROFILE_QUERY, {
  props: ({ data: { loading, currentUser }, ownProps: { client }}) => ({
    loading,
    currentUser,
    resetOnLogout: async () => client.resetStore(),
  }),
})(Profile));
```

To register a callback function to be executed after the store has been reset, call `client.onResetStore` and pass in your callback. If you would like to register multiple callbacks, simply call `client.onResetStore` again. All of your callbacks will be pushed into an array and executed concurrently.

In this example, we're using `client.onResetStore` to write default values to the cache. This is useful when using Apollo Client's [local state management](../data/local-state/) features and calling `client.resetStore` anywhere in your application.

```js
import { ApolloClient, InMemoryCache } from '@apollo/client';

import { resolvers, defaults } from './resolvers';

const cache = new InMemoryCache();

const client = new ApolloClient({
  cache,
  link: stateLink,
  defaults,
});

client.onResetStore(() => 
  cache.writeQuery({
    query: gql`{ cachedData}`,
    data: {
      cachedData: defaults
      }
}));
```

You can also call `client.onResetStore` from your React components. This can be useful if you would like to force your UI to rerender after the store has been reset.

If you would like to unsubscribe your callbacks from resetStore, use the return value of `client.onResetStore` for your unsubscribe function.

```js
import { withApollo } from "@apollo/react-hoc";

export class Foo extends Component {
  constructor(props) {
    super(props);
    this.unsubscribe = props.client.onResetStore(
      () => this.setState({ reset: false })
    );
    this.state = { reset: false };
  }
  componentDidUnmount() {
    this.unsubscribe();
  }
  render() {
    return this.state.reset ? <div /> : <span />
  }
}

export default withApollo(Foo);
```

If you want to clear the store but don't want to refetch active queries, use
`client.clearStore()` instead of `client.resetStore()`.

### Server side rendering

First, you will need to initialize an `InMemoryCache` on the server and create an instance of `ApolloClient`. In the initial serialized HTML payload from the server, you should include a script tag that extracts the data from the cache. (The `.replace()` is necessary to prevent script injection attacks)

```js
`<script>
  window.__APOLLO_STATE__=${JSON.stringify(cache.extract()).replace(/</g, '\\u003c')}
</script>`
```

On the client, you can rehydrate the cache using the initial data passed from the server:

```js
cache: new Cache().restore(window.__APOLLO_STATE__)
```

If you would like to learn more about server side rendering, please check out our more in depth guide [here](../performance/server-side-rendering/).

### Cache persistence

If you would like to persist and rehydrate your Apollo Cache from a storage provider like `AsyncStorage` or `localStorage`, you can use [`apollo-cache-persist`](https://github.com/apollographql/apollo-cache-persist). `apollo-cache-persist` works with all Apollo caches, including `InMemoryCache` & `Hermes`, and a variety of different [storage providers](https://github.com/apollographql/apollo-cache-persist#storage-providers).

To get started, simply pass your Apollo Cache and a storage provider to `persistCache`. By default, the contents of your Apollo Cache will be immediately restored asynchronously, and persisted upon every write to the cache with a short configurable debounce interval.

> Note: The `persistCache` method is async and returns a `Promise`.

```js
import { AsyncStorage } from 'react-native';
import { InMemoryCache } from '@apollo/cache';
import { persistCache } from 'apollo-cache-persist';

const cache = new InMemoryCache();

persistCache({
  cache,
  storage: AsyncStorage,
}).then(() => {
  // Continue setting up Apollo as usual.
})
```

For more advanced usage, such as persisting the cache when the app is in the background, and additional configuration options, please check the [README of `apollo-cache-persist`](https://github.com/apollographql/apollo-cache-persist).
