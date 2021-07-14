---
title: Fragments
description: Share fields between operations
---

A [GraphQL fragment](http://graphql.org/learn/queries/#fragments) is a piece of logic that can be shared between multiple queries and mutations.

Here's the declaration of a `NameParts` fragment that can be used with any `Person` object:

```graphql
fragment NameParts on Person {
  firstName
  lastName
}
```

Every fragment includes a subset of the fields that belong to its associated type. In the above example, the `Person` type must declare `firstName` and `lastName` fields for the `NameParts` fragment to be valid.

We can now include the `NameParts` fragment in any number of queries and mutations that refer to `Person` objects, like so:

```graphql
query GetPerson {
  people(id: "7") {
    ...NameParts
    avatar(size: LARGE)
  }
}
```

>You precede an included fragment with three periods (`...`), much like JavaScript [spread syntax](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Spread_syntax).

Based on our `NameParts` definition, the above query is equivalent to:

```graphql
query GetPerson {
  people(id: "7") {
    firstName
    lastName
    avatar(size: LARGE)
  }
}
```

If we later _change_ which fields are included in the `NameParts` fragment, we automatically change which fields are included in operations that _use_ the fragment. This reduces the effort required to keep fields consistent across a set of operations.

## Example usage

Let's say we have a blog application that executes several GraphQL operations related to comments (submitting a comment, fetching a post's comments, etc.). These operations probably _all_ include certain fields of a `Comment` type.

To specify this core set of fields, we can define a fragment on the `Comment` type, like so:

```js:title=fragments.js
import { gql } from '@apollo/client';

export const CORE_COMMENT_FIELDS = gql`
  fragment CoreCommentFields on Comment {
    id
    postedBy {
      username
      displayName
    }
    createdAt
    content
  }
`;
```

> You can declare fragments in any file of your application. The example above `export`s the fragment from a `fragments.js` file.

We can then include the `CoreCommentFields` fragment in a GraphQL operation like so:

```jsx{2,5,12}:title=PostDetails.jsx
import { gql } from '@apollo/client';
import { CORE_COMMENT_FIELDS } from './fragments';

export const GET_POST_DETAILS = gql`
  ${CORE_COMMENT_FIELDS}
  query CommentsForPost($postId: ID!) {
    post(postId: $postId) {
      title
      body
      author
      comments {
        ...CoreCommentFields
      }
    }
  }
`;

// ...PostDetails component definition...
```

* We first `import` `CORE_COMMENT_FIELDS` because it's declared in another file.
* We add our fragment definition to the `GET_POST_DETAILS` `gql` template literal via a placeholder (`${CORE_COMMENT_FIELDS}`)
* We include the `CoreCommentFields` fragment in our query with standard `...` notation.

## Colocating fragments

The tree-like structure of a GraphQL response resembles the hierarchy of a frontend's rendered components. Because of this similarity, you can use fragments to split query logic up _between_ components, so that each component requests exactly the fields that it uses. This helps you make your component logic more succinct.

Consider the following view hierarchy for an app:

```
FeedPage
└── Feed
    └── FeedEntry
        ├── EntryInfo
        └── VoteButtons
```

In this app, the `FeedPage` component executes a query to fetch a list of `FeedEntry` objects. The `EntryInfo` and `VoteButtons` subcomponents need specific fields from the enclosing `FeedEntry` object.

### Creating colocated fragments

A colocated fragment is just like any other fragment, except it's attached to a particular component that uses the fragment's fields. For example, the `VoteButtons` child component of `FeedPage` might use the fields `score` and `vote { choice }` from the `FeedEntry` object:

```js:title=VoteButtons.jsx
VoteButtons.fragments = {
  entry: gql`
    fragment VoteButtonsFragment on FeedEntry {
      score
      vote {
        choice
      }
    }
  `,
};
```

After you define a fragment in a child component, the _parent_ component can refer to it in its _own_ colocated fragments, like so:

```js:title=FeedEntry.jsx
FeedEntry.fragments = {
  entry: gql`
    fragment FeedEntryFragment on FeedEntry {
      commentCount
      repository {
        full_name
        html_url
        owner {
          avatar_url
        }
      }
      ...VoteButtonsFragment
      ...EntryInfoFragment
    }
    ${VoteButtons.fragments.entry}
    ${EntryInfo.fragments.entry}
  `,
};
```

There's nothing special about the naming of `VoteButtons.fragments.entry` or `EntryInfo.fragments.entry`. Any naming convention works as long as you can retrieve a component's fragments given the component.

### Importing fragments when using Webpack

When loading `.graphql` files with [graphql-tag/loader](https://github.com/apollographql/graphql-tag/blob/main/loader.js), we can include fragments using `import` statements. For example:

```graphql
#import "./someFragment.graphql"
```

This makes the contents of `someFragment.graphql` available to the current file. See the [Webpack Fragments](../integrations/webpack/#fragments) section for additional details.

## Using fragments with unions and interfaces

You can define fragments on [unions and interfaces](https://www.apollographql.com/docs/apollo-server/schema/unions-interfaces/).

Here's an example of a query that includes three in-line fragments:

```graphql
query AllCharacters {
  all_characters {

    ... on Character {
      name
    }

    ... on Jedi {
      side
    }

    ... on Droid {
      model
    }
  }
}
```

The `all_characters` query above returns a list of `Character` objects. The `Character` type is an interface that both the `Jedi` and `Droid` types implement. Each item in the list includes a `side` field if it's an object of type `Jedi`, and it includes a `model` field if it's of type `Droid`.

**However**, for this query to work, your client needs to understand the polymorphic relationship between the `Character` interface and the types that implement it. To inform the client about these relationships, you can pass a `possibleTypes` option when you initialize your `InMemoryCache`.

### Defining `possibleTypes` manually

> The `possibleTypes` option is available in Apollo Client 3.0 and later.

You can pass a `possibleTypes` option to the `InMemoryCache` constructor to specify supertype-subtype relationships in your schema. This object maps the name of an interface or union type (the supertype) to the types that implement or belong to it (the subtypes).

Here's an example `possibleTypes` declaration:

```ts
const cache = new InMemoryCache({
  possibleTypes: {
    Character: ["Jedi", "Droid"],
    Test: ["PassingTest", "FailingTest", "SkippedTest"],
    Snake: ["Viper", "Python"],
  },
});
```

This example lists three interfaces (`Character`, `Test`, and `Snake`) and the object types that implement them.

If your schema includes only a few unions and interfaces, you can probably specify your `possibleTypes` manually without issue. However, as your schema grows in size and complexity, you should consider [generating `possibleTypes` automatically from your schema](#generating-possibletypes-automatically).

### Generating `possibleTypes` automatically

The following example script translates a GraphQL introspection query into a `possibleTypes` configuration object:

```js
const fetch = require('cross-fetch');
const fs = require('fs');

fetch(`${YOUR_API_HOST}/graphql`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    variables: {},
    query: `
      {
        __schema {
          types {
            kind
            name
            possibleTypes {
              name
            }
          }
        }
      }
    `,
  }),
}).then(result => result.json())
  .then(result => {
    const possibleTypes = {};

    result.data.__schema.types.forEach(supertype => {
      if (supertype.possibleTypes) {
        possibleTypes[supertype.name] =
          supertype.possibleTypes.map(subtype => subtype.name);
      }
    });

    fs.writeFile('./possibleTypes.json', JSON.stringify(possibleTypes), err => {
      if (err) {
        console.error('Error writing possibleTypes.json', err);
      } else {
        console.log('Fragment types successfully extracted!');
      }
    });
  });
```

You can then `import` the generated `possibleTypes` JSON module into the file where you create your `InMemoryCache`:

```ts
import possibleTypes from './path/to/possibleTypes.json';

const cache = new InMemoryCache({
  possibleTypes,
});
```
