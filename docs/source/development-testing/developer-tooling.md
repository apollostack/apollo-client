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


## Apollo Codegen

Apollo Codegen is a tool to generate API code or type annotations based on a GraphQL schema and query documents.

It currently generates Swift code, TypeScript annotations, Flow annotations, and Scala code, we hope to add support for other targets in the future.

See [Apollo iOS](https://github.com/apollographql/apollo-ios) for details on the mapping from GraphQL results to Swift types, as well as runtime support for executing queries and mutations. For Scala, see [React Apollo Scala.js](https://github.com/apollographql/react-apollo-scalajs) for details on how to use generated Scala code in a Scala.js app with Apollo Client.

### Usage

If you want to use `apollo-codegen`, you can install it command globally:

```bash
npm install -g apollo-codegen
```

### `introspect-schema`

The purpose of this command is to create a JSON introspection dump file for a given graphql schema. The input schema can be fetched from a remote graphql server or from a local file. The resulting JSON introspection dump file is needed as input to the [generate](#generate) command.

To download a GraphQL schema by sending an introspection query to a server:

```bash
apollo-codegen introspect-schema http://localhost:8080/graphql --output schema.json
```

You can use the `header` option to add additional HTTP headers to the request. For example, to include an authentication token, use `--header "Authorization: Bearer <token>"`.

You can use the `insecure` option to ignore any SSL errors (for example if the server is running with self-signed certificate).

To generate a GraphQL schema introspection JSON from a local GraphQL schema:

```bash
apollo-codegen introspect-schema schema.graphql --output schema.json
```

### `generate`

The purpose of this command is to generate types for query and mutation operations made against the schema (it will not generate types for the schema itself).

This tool will generate Swift code by default from a set of query definitions in `.graphql` files:

```bash
apollo-codegen generate **/*.graphql --schema schema.json --output API.swift
```

You can also generate type annotations for TypeScript, Flow, or Scala using the `--target` option:

```bash
# TypeScript
apollo-codegen generate **/*.graphql --schema schema.json --target typescript --output operation-result-types.ts
# Flow
apollo-codegen generate **/*.graphql --schema schema.json --target flow --output operation-result-types.flow.js
# Scala
apollo-codegen generate **/*.graphql --schema schema.json --target scala --output operation-result-types.scala
```

### `gql` template support

If the source file for generation is a javascript or typescript file, the codegen will try to extrapolate the queries inside the [gql tag](https://github.com/apollographql/graphql-tag) templates.

The tag name is configurable using the CLI `--tag-name` option.

### .graphqlconfig support

Instead of using the `--schema` option to point out your GraphQL schema, you can specify it in a [`.graphqlconfig`](https://github.com/graphcool/graphql-config) file.

In case you specify multiple schemas in your `.graphqlconfig` file, choose which one to pick by using the `--project-name` option.

### Typescript and Flow

When using `apollo-codegen` with Typescript or Flow, make sure to add the `__typename` introspection field to every selection set within your graphql operations.

If you're using a client like `@apollo/client` that does this automatically for your GraphQL operations, pass in the `--addTypename` option to `apollo-codegen` to make sure the generated Typescript and Flow types have the `__typename` field as well. This is required to ensure proper type generation support for `GraphQLUnionType` and `GraphQLInterfaceType` fields.

**Why is the __typename field required?**

Using the type information from the GraphQL schema, we can infer the possible types for fields. However, in the case of a `GraphQLUnionType` or `GraphQLInterfaceType`, there are multiple types that are possible for that field. This is best modeled using a disjoint union with the `__typename`
as the discriminant.

For example, given a schema:

```graphql
interface Character {
  name: String!
}

type Human implements Character {
  homePlanet: String
}

type Droid implements Character {
  primaryFunction: String
}
```

Whenever a field of type `Character` is encountered, it could be either a Human or Droid. Human and Droid objects
will have a different set of fields. Within your application code, when interacting with a `Character` you'll want to make sure to handle both of these cases.

Given this query:

```graphql
query Characters {
  characters(episode: NEW_HOPE) {
    name

    ... on Human {
      homePlanet
    }

    ... on Droid {
      primaryFunction
    }
  }
}
```

Apollo Codegen will generate a union type for Character.

```ts
export type CharactersQuery = {
  characters: Array<{
    __typename: 'Human',
    name: string,
    homePlanet: ?string
  } | {
    __typename: 'Droid',
    name: string,
    primaryFunction: ?string
  }>
}
```

This type can then be used as follows to ensure that all possible types are handled:

```tsx
function CharacterFigures({ characters }: CharactersQuery) {
  return characters.map(character => {
    switch(character.__typename) {
      case "Human":
        return <HumanFigure homePlanet={character.homePlanet} name={character.name} />
      case "Droid":
        return <DroidFigure primaryFunction={character.primaryFunction} name={character.name} />
    }
  });
}
```
