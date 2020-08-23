---
title: Developer tools
description: Improve your developer experience with these these services and extensions
---

## Apollo Studio

[Apollo Studio](https://www.apollographql.com/docs/platform/graph-manager-overview/) (formerly Graph Manager) is a cloud app that provides a single, consolidated place for you to collaborate on the evolution of your graph.

It provides the following features to all Apollo users for free:

- A query window that connects to all your environments and provides erganomic ways to author and manage queries.
- A GraphQL schema registry that tracks the evolution of your graph across your environments.
- Key insights into which parts of your schema are being actively used, and by whom.
- Team collaboration via organizations

Advanced features are available with a subscription to an Apollo Team or Enterprise plan.

To learn more about Graph Manager, check out the [overview](https://www.apollographql.com/docs/platform/graph-manager-overview/).

## Apollo Client Devtools

The Apollo Client Devtools are available as extension for [Chrome](https://chrome.google.com/webstore/detail/apollo-client-developer-t/jdkknkkbebbapilgoeccciglkfbmbnfm) and [Firefox](https://addons.mozilla.org/en-US/firefox/addon/apollo-developer-tools/).

### Features

The devtools appear as an "Apollo" tab in your Chrome inspector, along side the "Elements" and "Console" tabs. There are currently 3 main features of the devtools:

 * GraphiQL: Send queries to your server through the Apollo network interface, or query the Apollo cache to see what data is loaded.
 * Normalized store inspector: Visualize your GraphQL store the way Apollo Client sees it, and search by field names or values.
 * Watched query inspector: View active queries and variables, and locate the associated UI components.

 ![GraphiQL Console](../assets/devtools/apollo-client-devtools/apollo-devtools-graphiql.png)

Make requests against either your app’s GraphQL server or the Apollo Client cache through the Chrome developer console. This version of GraphiQL leverages your app’s network interface, so there’s no configuration necessary — it automatically passes along the proper HTTP headers, etc. the same way your Apollo Client app does.

![Store Inspector](../assets/devtools/apollo-client-devtools/apollo-devtools-store.png)

View the state of your client-side cache as a tree and inspect every object inside. Visualize the [mental model](https://blog.apollographql.com/the-concepts-of-graphql-bc68bd819be3) of the Apollo cache. Search for specific keys and values in the store and see the path to those keys highlighted.

![Watched Query Inspector](../assets/devtools/apollo-client-devtools/apollo-devtools-queries.png)

View the queries being actively watched on any given page. See when they're loading, what variables they're using, and, if you’re using React, which React component they’re attached to. Angular support coming soon.

### Installation

You can install the extension via the [Chrome Webstore](https://chrome.google.com/webstore/detail/apollo-client-developer-t/jdkknkkbebbapilgoeccciglkfbmbnfm).
If you want to install a local version of the extension instead, skip ahead to the __Developing__ section.

### Configuration

While your app is in dev mode, the devtools will appear as an "Apollo" tab in your chrome inspector. To enable the devtools in your app even in production, pass `connectToDevTools: true` to the ApolloClient constructor in your app.  Pass `connectToDevTools: false` if want to manually disable this functionality.

The "Apollo" tab will appear in the Chrome console if a global `window.__APOLLO_CLIENT__` object exists in your app. Apollo Client adds this hook to the window automatically unless `process.env.NODE_ENV === 'production'`. If you would like to use the devtools in production, just manually attach your Apollo Client instance to `window.__APOLLO_CLIENT__` or pass `connectToDevTools: true` to the constructor.

Find more information about contributing and debugging on the [Apollo Client DevTools GitHub page](https://github.com/apollographql/apollo-client-devtools).


## Apollo CLI

The [Apollo CLI](https://www.apollographql.com/docs/devtools/cli/) is a suite of tools to enable workflows for  every data graph. To improve developer velocity, the Apollo CLI supports type generation and client SDK creation. For production data graphs, the Apollo CLI provides operation and schema validation, operation safelisting, and federated service discovery.

### Usage

To use the Apollo CLI, you can install it, `apollo`, with:

```bash
npm install -g apollo
```

### Code generation

The Apollo CLI generates client SDKs for Swift and Scala and type definitions for TypeScript and Flow. For example, after [setting up an Apollo project](https://www.apollographql.com/docs/devtools/apollo-config/), `apollo` can generate typescript annotations with:

```bash
# TypeScript
apollo client:codegen --target=typescript
```

For more information on Swift SDKs, see [Apollo iOS](https://www.apollographql.com/docs/ios/) for details on the mapping from GraphQL results to Swift classes, as well as runtime support for executing queries and mutations. For Scala, see [React Apollo Scala.js](https://www.apollographql.com/docs/scalajs/) for details on how to use generated Scala code in a Scala.js app with Apollo Client.

### Validation

The Apollo CLI can validate operations and schemas to ensure that changes to a data graph do not break an existing client and future clients will work with a future data graph.

The [schema validation documentation](https://www.apollographql.com/docs/graph-manager/schema-validation/) describes how to setup the workflow. For more information about operation validation, run `apollo help client:check`.

### Operation safelisting

For servers that enforce an operation safelist, the Apollo CLI can register operations in a client bundle with a server. The [operation registry documentation](https://www.apollographql.com/docs/graph-manager/operation-registry/) describes the steps to protecting a data graph from malicious or dangerous operations.

### Federated service discovery

A data graph can be composed of multiple backend services. With a managed deployment, the Apollo CLI can fetch and list them to support developers. The [managed federation documentation](https://www.apollographql.com/docs/graph-manager/managed-federation/overview/) describes how to setup a federated data graph and `npx apollo help service:list` contains the CLI configuration.
