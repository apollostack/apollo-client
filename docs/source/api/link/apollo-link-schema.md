---
title: Schema Link
sidebar_title: Schema
description: Assists with mocking and server-side rendering
---

## Overview

The schema link provides a [graphql execution environment](http://graphql.org/graphql-js/graphql/#graphql), which allows you to perform GraphQL operations on a provided schema. This type of behavior is commonly used for server-side rendering (SSR) to avoid network calls and mocking data. While the schema link could provide graphql results on the client, currently the graphql execution layer is [too heavy weight](https://bundlephobia.com/result?p=graphql) for practical application.

> To unify your state management with client-side GraphQL operations, refer to Apollo Client's [local state management](../../local-state/local-state-management/) functionality. It integrates with the Apollo Client cache and is much more lightweight.

## Installation

`npm install @apollo/client --save`

## Usage

### Server Side Rendering

When performing SSR _on the same server_, you can use this library to avoid making network calls.

```js
import { ApolloClient, InMemoryCache } from '@apollo/client';
import { SchemaLink } from '@apollo/client/link/schema';

import schema from './path/to/your/schema';

const graphqlClient = new ApolloClient({
  cache: new InMemoryCache(),
  ssrMode: true,
  link: new SchemaLink({ schema })
});
```

### Mocking

For more detailed information about mocking, refer to the [graphql-tools documentation](https://www.apollographql.com/docs/graphql-tools/mocking.html).

```js
import { ApolloClient, InMemoryCache } from '@apollo/client';
import { SchemaLink } from '@apollo/client/link/schema';
import { makeExecutableSchema, addMockFunctionsToSchema } from 'graphql-tools';

const typeDefs = `
  Query {
  ...
  }
`;

const mocks = {
  Query: () => ...,
  Mutation: () => ...
};

const schema = makeExecutableSchema({ typeDefs });
const schemaWithMocks = addMockFunctionsToSchema({
  schema,
  mocks
});

const apolloCache = new InMemoryCache(window.__APOLLO_STATE__);

const graphqlClient = new ApolloClient({
  cache: apolloCache,
  link: new SchemaLink({ schema: schemaWithMocks })
});
```

### Options

The `SchemaLink` constructor can be called with an object with the following properties:

| Option | Description |
| - | - |
| `schema` | An executable graphql schema |
| `rootValue` | The root value that is passed to the resolvers (i.e. the first parameter for the [rootQuery](http://graphql.org/learn/execution/#root-fields-resolvers)) |
| `context` | An object passed to the resolvers, following the [graphql specification](http://graphql.org/learn/execution/#root-fields-resolvers) or a function that accepts the operation and returns the resolver context. The resolver context may contain all the data-fetching connectors for an operation. |
| `validate` | Enable validation of incoming queries against the local schema before execution, returning validation errors in `result.errors`, just like a non-local GraphQL endpoint typically would. |
