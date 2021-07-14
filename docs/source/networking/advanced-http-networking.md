---
title: Advanced HTTP networking
description: Take full network control with Apollo Link
---

The **Apollo Link** library gives you fine-grained control of HTTP requests that are sent by Apollo Client. You can also use it to replace Apollo Client's networking layer with something completely custom, such as a WebSocket transport or mocked server data.

When using Apollo Link, you define network behavior as a collection of **link** objects that execute in sequence to control the flow of data. By default, Apollo Client uses Apollo Link's `HttpLink` to send GraphQL queries over HTTP.

Apollo Link includes installable, premade links that support a variety of use cases. You can also create your own custom links.

## Customizing request logic

The following example demonstrates adding a custom link to Apollo Client. This link adds an `Authorization` header to every HTTP request before the `HttpLink` sends it:

```js
import { ApolloClient, HttpLink, ApolloLink, InMemoryCache, concat } from '@apollo/client';

const httpLink = new HttpLink({ uri: '/graphql' });

const authMiddleware = new ApolloLink((operation, forward) => {
  // add the authorization to the headers
  operation.setContext(({ headers = {} }) => ({
    headers: {
      ...headers,
      authorization: localStorage.getItem('token') || null,
    }
  }));

  return forward(operation);
})

const client = new ApolloClient({
  cache: new InMemoryCache(),
  link: concat(authMiddleware, httpLink),
});
```

This next example demonstrates providing multiple custom links in an array:

```js
import { ApolloClient, HttpLink, ApolloLink, InMemoryCache, from } from '@apollo/client';

const httpLink = new HttpLink({ uri: '/graphql' });

const authMiddleware = new ApolloLink((operation, forward) => {
  // add the authorization to the headers
  operation.setContext(({ headers = {} }) => ({
    headers: {
      ...headers,
      authorization: localStorage.getItem('token') || null,
    }
  }));

  return forward(operation);
})

const activityMiddleware = new ApolloLink((operation, forward) => {
  // add the recent-activity custom header to the headers
  operation.setContext(({ headers = {} }) => ({
    headers: {
      ...headers,
      'recent-activity': localStorage.getItem('lastOnlineTime') || null,
    }
  }));

  return forward(operation);
})

const client = new ApolloClient({
  cache: new InMemoryCache(),
  link: from([
    authMiddleware,
    activityMiddleware,
    httpLink
  ]),
});
```

In the example above, the `authMiddleware` link sets each request's `Authorization` header, and the `activityMiddleware` then sets each request's `Recent-Activity` header. Finally, the `HttpLink` sends the modified request.

## Customizing response logic

You can use Apollo Link to customize Apollo Client's behavior whenever it receives a response from a request.

The following example demonstrates using [`@apollo/client/link/error`](../api/link/apollo-link-error/) to handle network errors that are included in a response:

```js
import { ApolloClient, InMemoryCache, HttpLink } from '@apollo/client';
import { onError } from '@apollo/client/link/error';

import { logout } from './logout';

const httpLink = new HttpLink({ uri: '/graphql' });

const logoutLink = onError(({ networkError }) => {
  if (networkError.statusCode === 401) logout();
})

const client = new ApolloClient({
  cache: new InMemoryCache(),
  link: logoutLink.concat(httpLink),
});
```

In this example, the user is logged out of the application if the server returns a `401` code (unauthorized).

### Modifying response data

You can create a custom link that adds, edits, or removes fields from `response.data`. To do so, you call `map` on the result of the link's `forward(operation)` call. In the `map` function, make any desired changes to `response.data` and then return it:

```js
import { ApolloClient, InMemoryCache, HttpLink, ApolloLink } from '@apollo/client';

const httpLink = new HttpLink({ uri: '/graphql' });

const addDateLink = new ApolloLink((operation, forward) => {
  return forward(operation).map(response => {
    response.data.date = new Date();
    return response;
  });
});

const client = new ApolloClient({
  cache: new InMemoryCache(),
  link: addDateLink.concat(httpLink),
});
```

In the above example, `addDateLink` adds a `date` field to the top level of each response.

Note that `forward(operation).map(func)` _doesn't_ support asynchronous execution of the `func` mapping function. If you need to make asynchronous modifications, use the `asyncMap` function from `@apollo/client/utilities`, like so:

```js
import {
  ApolloClient,
  InMemoryCache,
  HttpLink,
  ApolloLink
} from "@apollo/client";
import { asyncMap } from "@apollo/client/utilities";

import { usdToEur } from './currency';

const httpLink = new HttpLink({ uri: '/graphql' });

const usdToEurLink = new ApolloLink((operation, forward) => {
  return asyncMap(forward(operation), async (response) => {
    let data = response.data;
    if (data.price && data.currency === "USD") {
      data.price = await usdToEur(data.price);
      data.currency = "EUR";
    }
    return response;
  });
});

const client = new ApolloClient({
  cache: new InMemoryCache(),
  link: usdToEurLink.concat(httpLink)
});
```

In the example above, `usdToEurLink` uses `asyncMap` to convert the response object's `price` field from USD to EUR using an external API.

While this technique can be useful for modifying _existing_ fields (or adding additional objects to lists within `data`), adding _new_ fields to `data` won't work in most cases, because the operation document cannot be safely modified within the `ApolloLink` request pipeline.

## The `HttpLink` object

Apollo Client uses `HttpLink` to send GraphQL operations to a server over HTTP. The link supports both POST and GET requests, and it can modify HTTP options on a per-query basis. This comes in handy when implementing authentication, persisted queries, dynamic URIs, and other granular updates.

> If your client doesn't have complex HTTP requirements, you probably don't need to create a custom instance of `HttpLink`. For details, see [Basic HTTP networking](./basic-http-networking/).

### Usage

```js
import { HttpLink } from "@apollo/client";

const link = new HttpLink({ uri: "/graphql" });
```

### Constructor options

The `HttpLink` constructor accepts the following options:

| Options | Description |
| - | - |
| `uri` | A string endpoint or function that resolves to the GraphQL server you want to execute operations against. (default: `/graphql`)|
| `includeExtensions` | If `true`, you can pass an `extensions` field to your GraphQL server. (default: `false`) |
| `fetch` | A `fetch`-compatible API for making a request. See [Providing a `fetch` replacement for certain environments](#providing-a-fetch-replacement-for-certain-environments). |
| `headers` | An object containing header names and values to include in each request. |
| `credentials` | A string representing the credentials policy to use for the `fetch` call. (valid values: `omit`, `include`, `same-origin`) |
| `fetchOptions` | Include this to override the values of certain options that are provided to the `fetch` call. |
| `useGETForQueries` | If `true`, `HttpLink` uses `GET` requests instead of `POST` requests to execute query operations (but not mutation operations). (default: `false`) |

#### Providing a `fetch` replacement for certain environments

`HttpLink` requires that `fetch` is present in your runtime environment. This is the case for React Native and most modern browsers. If you're targeting an environment that _doesn't_ include `fetch` (such as older browsers or the server), you need to pass your own `fetch` to `HttpLink` via its [constructor options](#constructor-options). We recommend using [`cross-fetch`](https://www.npmjs.com/package/cross-fetch) for older browsers and Node.

### Overriding options

You can override most `HttpLink` constructor options on an operation-by-operation basis by modifying the `context` object for the operation. For example, you can set the `headers` field on the `context` to pass custom headers for a particular operation. The `context` also supports the `credentials` field for defining credentials policy, `uri` for changing the endpoint dynamically, and `fetchOptions` to allow generic fetch overrides (i.e., `method: "GET"`).

Note that if you set `fetchOptions.method` to `GET`, `HttpLink` follows the [standard GraphQL HTTP GET encoding](http://graphql.org/learn/serving-over-http/#get-request). The query, variables, operation name, and extensions are passed as query parameters instead of in the HTTP request body (because there isn't one). If you to continue to send mutations as non-idempotent `POST` requests, set the top-level `useGETForQueries` option to `true` instead of setting `fetchOptions.method` to `GET`.

`HttpLink` also attaches the response from the `fetch` operation to the context as `response`, so you can access it in another link.

Context options:

| Option | Description |
| - | - |
| `headers` | An object containing header names and values to include in each request. |
| `credentials` | A string representing the credentials policy to use for the `fetch` call. (valid values: `omit`, `include`, `same-origin`) |
| `uri` | A string endpoint or function that resolves to the GraphQL server you want to execute operations against. |
| `fetchOptions` | Any overrides of the fetch options argument to pass to the `fetch` call. |
| `response` | The raw response from the `fetch` request after it is made. |
| `http` | An object that lets you control fine-grained aspects of `HttpLink` itself, such as persisted queries (see below). |

The following example shows how to use the `context` to pass a special header for a single query:

```js
import { ApolloClient, InMemoryCache } from "@apollo/client";

const client = new ApolloClient({
  cache: new InMemoryCache(),
  uri: "/graphql"
});

client.query({
  query: MY_QUERY,
  context: {
    // example of setting the headers with context per operation
    headers: {
      special: "Special header value"
    }
  }
});
```

### Custom fetching

`HttpLink`'s `fetch` option can be used to wire in custom networking. This is useful if you want to modify the request based on calculated headers, or calculate the URI based on an operation. For example:

**Custom auth:**

```js
const customFetch = (uri, options) => {
  const { header } = Hawk.client.header(
    "http://example.com:8000/resource/1?b=1&a=2",
    "POST",
    { credentials: credentials, ext: "some-app-data" }
  );
  options.headers.Authorization = header;
  return fetch(uri, options);
};

const link = new HttpLink({ fetch: customFetch });
```

**Dynamic URI:**

```js
const customFetch = (uri, options) => {
  const { operationName } = JSON.parse(options.body);
  return fetch(`${uri}/graph/graphql?opname=${operationName}`, options);
};

const link = new HttpLink({ fetch: customFetch });
```

## Using other links

Apollo Link includes many links for specialized use cases, such as the `WebSocketLink` for communicating over WebSocket and the `BatchHttpLink` for combining multiple GraphQL operations in a single HTTP request.

To learn more about what's available, see the [Apollo Link API documentation](../api/link/introduction/).
