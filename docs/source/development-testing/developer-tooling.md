---
title: Developer tools
description: Improve your developer experience with these services and extensions
---

## Apollo Studio

[Apollo Studio](https://www.apollographql.com/docs/platform/graph-manager-overview/) (formerly Graph Manager) is a cloud app that provides a single, consolidated place for you to collaborate on the evolution of your graph.

It provides the following features to all Apollo users for free:

- A query window that connects to all your environments and provides ergonomic ways to author and manage queries.
- A GraphQL schema registry that tracks the evolution of your graph across your environments.
- Key insights into which parts of your schema are being actively used, and by whom.
- Team collaboration via organizations

Advanced features are available with a subscription to an Apollo Team or Enterprise plan.

To learn more about Apollo Studio, check out the [overview](https://www.apollographql.com/docs/studio/).

## Apollo Client Devtools

The Apollo Client Devtools are available as an extension for [Chrome](https://chrome.google.com/webstore/detail/apollo-client-developer-t/jdkknkkbebbapilgoeccciglkfbmbnfm) and [Firefox](https://addons.mozilla.org/en-US/firefox/addon/apollo-developer-tools/).

### Features

The Apollo Client Devtools appear as an "Apollo" tab in your web browser's Inspector panel, alongside default tabs like "Console" and "Network". The devtools currently have four main features:

- **GraphiQL:** Send queries to your server through your web application's configured Apollo Client instance, or query the Apollo Client cache to see what data is loaded.
- **Watched query inspector:** View active queries, variables, and cached results, and re-run individual queries.
- **Mutation inspector:** View active mutations and their variables, and re-run individual mutations.
- **Cache inspector:** Visualize the Apollo Client cache and search it by field name and/or value.

![Apollo Client Devtools](../assets/devtools/apollo-client-devtools/ac-browser-devtools-3.png)

### Installation

You can install the extension via the webstores for [Chrome](https://chrome.google.com/webstore/detail/apollo-client-developer-t/jdkknkkbebbapilgoeccciglkfbmbnfm) and [Firefox](https://addons.mozilla.org/en-US/firefox/addon/apollo-developer-tools/).

### Configuration

While your app is in dev mode, the Apollo Client Devtools will appear as an "Apollo" tab in your web browser inspector. To enable the devtools in your app in production, pass `connectToDevTools: true` to the `ApolloClient` constructor in your app. Pass `connectToDevTools: false` if want to manually disable this functionality.

Find more information about contributing and debugging on the [Apollo Client Devtools GitHub page](https://github.com/apollographql/apollo-client-devtools).

