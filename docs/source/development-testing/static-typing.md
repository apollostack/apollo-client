---
title: Using Apollo with TypeScript
sidebar_title: Using TypeScript
---

As your application grows, you may find it helpful to include a type system to assist in development. Apollo supports type definitions for TypeScript out of the box. Apollo Client ships with definitions in its associated npm package, so installation should be done for you after the libraries are included in your project.

These docs assume you already have TypeScript configured in your project, if not start [here](https://github.com/Microsoft/TypeScript-React-Conversion-Guide#typescript-react-conversion-guide).

The most common need when using type systems with GraphQL is to type the results of an operation. Given that a GraphQL server's schema is strongly typed, we can even generate TypeScript definitions automatically using a tool like [apollo-codegen](https://github.com/apollographql/apollo-codegen). In these docs however, we will be writing result types manually.

## Typing hooks

Apollo Client's `useQuery`, `useMutation` and `useSubscription` React hooks are fully typed, and Generics can be used to type both incoming operation variables and GraphQL result data. React Hook options and result types are listed in the [Hooks API](../api/react/hooks/) section of the docs. You can find a typed example of each Hook below.

### `useQuery`

```jsx
import React from 'react';
import { useQuery, gql } from '@apollo/client';

interface RocketInventory {
  id: number;
  model: string;
  year: number;
  stock: number;
}

interface RocketInventoryData {
  rocketInventory: RocketInventory[];
}

interface RocketInventoryVars {
  year: number;
}

const GET_ROCKET_INVENTORY = gql`
  query GetRocketInventory($year: Int!) {
    rocketInventory(year: $year) {
      id
      model
      year
      stock
    }
  }
`;

export function RocketInventoryList() {
  const { loading, data } = useQuery<RocketInventoryData, RocketInventoryVars>(
    GET_ROCKET_INVENTORY,
    { variables: { year: 2019 } }
  );
  return (
    <div>
      <h3>Available Inventory</h3>
      {loading ? (
        <p>Loading ...</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th>Stock</th>
            </tr>
          </thead>
          <tbody>
            {data && data.rocketInventory.map(inventory => (
              <tr>
                <td>{inventory.model}</td>
                <td>{inventory.stock}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

### `useMutation`

```jsx
import React, { useState } from 'react';
import { useMutation, gql } from '@apollo/client';

const SAVE_ROCKET = gql`
  mutation saveRocket($rocket: RocketInput!) {
    saveRocket(rocket: $rocket) {
      model
    }
  }
`;

interface RocketInventory {
  id: number;
  model: string;
  year: number;
  stock: number;
}

interface NewRocketDetails {
  model: string;
  year: number;
  stock: number;
}

export function NewRocketForm() {
  const [model, setModel] = useState('');
  const [year, setYear] = useState(0);
  const [stock, setStock] = useState(0);

  const [saveRocket, { error, data }] = useMutation<
    { saveRocket: RocketInventory },
    { rocket: NewRocketDetails }
  >(SAVE_ROCKET, {
    variables: { rocket: { model, year: +year, stock: +stock } }
  });

  return (
    <div>
      <h3>Add a Rocket</h3>
      {error ? <p>Oh no! {error.message}</p> : null}
      {data && data.saveRocket ? <p>Saved!</p> : null}
      <form>
        <p>
          <label>Model</label>
          <input
            name="model"
            onChange={e => setModel(e.target.value)}
          />
        </p>
        <p>
          <label>Year</label>
          <input
            type="number"
            name="model"
            onChange={e => setYear(+e.target.value)}
          />
        </p>
        <p>
          <label>Stock</label>
          <input
            type="number"
            name="stock"
            onChange={e => setStock(e.target.value)}
          />
        </p>
        <button onClick={() => model && year && stock && saveRocket()}>
          Add
        </button>
      </form>
    </div>
  );
}
```

### `useSubscription`

```jsx
import React from 'react';
import { useSubscription, gql } from '@apollo/client';

interface Message {
  content: string;
}

interface News {
  latestNews: Message;
}

const LATEST_NEWS = gql`
  subscription getLatestNews {
    latestNews {
      content
    }
  }
`;

export function LatestNews() {
  const { loading, data } = useSubscription<News>(LATEST_NEWS);
  return (
    <div>
      <h5>Latest News</h5>
      <p>
        {loading ? 'Loading...' : data!.latestNews.content}
      </p>
    </div>
  );
}
```

## Typing Render Prop Components

Using Apollo together with TypeScript couldn't be easier than using it with component API released in React Apollo 2.1:

```tsx
const ALL_PEOPLE_QUERY = gql`
  query All_People_Query {
    allPeople {
      people {
        id
        name
      }
    }
  }
`;

interface Data {
  allPeople: {
    people: Array<{ id: string; name: string }>;
  };
};

interface Variables {
  first: number;
};

const AllPeopleComponent = <Query<Data, Variables> query={ALL_PEOPLE_QUERY}>
  {({ loading, error, data }) => { ... }}
</Query>
```

Now the `<Query />` component render prop function arguments are typed. Since we are not mapping any props coming into our component, nor are we rewriting the props passed down, we only need to provide the shape of our data and the variables for full typing to work! Everything else is handled by React Apollo's robust type definitions.

This approach is the exact same for the `<Query />`, `<Mutation />`, and `<Subscription />` components! Learn it once, and get the best types ever with Apollo.

### Extending components

In previous versions of React Apollo, render prop components (`Query`, `Mutation` and `Subscription`) could be extended to add additional type information:

```js
class SomeQuery extends Query<SomeData, SomeVariables> {}
```

Since all class based render prop components have been converted to functional components, extending components in this manner is no longer possible. While we recommend switching over to use the new `useQuery`, `useMutation` and `useSubscription` hooks as soon as possible, if you're looking for a stop gap you can consider replacing your class with a wrapped and typed component:

```jsx
export const SomeQuery = () => (
  <Query<SomeData, SomeVariables> query={SOME_QUERY} /* ... */>
    {({ loading, error, data }) => { ... }}
  </Query>
);
```

## Typing Higher Order Components

Since the result of a query will be sent to the wrapped component as props, we want to be able to tell our type system the shape of those props. Here is an example setting types for an operation using the `graphql` higher order component (**note**: the follow sections also work for the query, mutation, and subscription hocs):

```tsx
import React from "react";
import { gql } from "@apollo/client";
import { ChildDataProps, graphql } from "@apollo/react-hoc";

const HERO_QUERY = gql`
  query GetCharacter($episode: Episode!) {
    hero(episode: $episode) {
      name
      id
      friends {
        name
        id
        appearsIn
      }
    }
  }
`;

type Hero = {
  name: string;
  id: string;
  appearsIn: string[];
  friends: Hero[];
};

type Response = {
  hero: Hero;
};

type Variables = {
  episode: string;
};

type ChildProps = ChildDataProps<{}, Response, Variables>;

// Note that the first parameter here is an empty Object, which means we're
// not checking incoming props for type safety in this example. The next
// example (in the "Options" section) shows how the type safety of incoming
// props can be ensured.
const withCharacter = graphql<{}, Response, Variables, ChildProps>(HERO_QUERY, {
  options: () => ({
    variables: { episode: "JEDI" }
  })
});

export default withCharacter(({ data: { loading, hero, error } }) => {
  if (loading) return <div>Loading</div>;
  if (error) return <h1>ERROR</h1>;
  return ...// actual component with data;
});
```

### Options

Typically, variables to the query will be computed from the props of the wrapper component. Wherever the component is used in your application, the caller would pass arguments that we want our type system to validate what the shape of these props could look like. Here is an example setting the type of props:

```tsx
import React from "react";
import { gql } from "@apollo/client";
import { ChildDataProps, graphql } from "@apollo/react-hoc";

const HERO_QUERY = gql`
  query GetCharacter($episode: Episode!) {
    hero(episode: $episode) {
      name
      id
      friends {
        name
        id
        appearsIn
      }
    }
  }
`;

type Hero = {
  name: string;
  id: string;
  appearsIn: string[];
  friends: Hero[];
};

type Response = {
  hero: Hero;
};

type InputProps = {
  episode: string;
};

type Variables = {
  episode: string;
};

type ChildProps = ChildDataProps<InputProps, Response, Variables>;

const withCharacter = graphql<InputProps, Response, Variables, ChildProps>(HERO_QUERY, {
  options: ({ episode }) => ({
    variables: { episode }
  }),
});

export default withCharacter(({ data: { loading, hero, error } }) => {
  if (loading) return <div>Loading</div>;
  if (error) return <h1>ERROR</h1>;
  return ...// actual component with data;
});
```

This is especially helpful when accessing deeply nested objects that are passed down to the component through props. For example, when adding prop types, a project using TypeScript will begin to surface errors where props being passed are invalid:

```tsx
import React from "react";
import {
  ApolloClient,
  createHttpLink,
  InMemoryCache,
  ApolloProvider
} from "@apollo/client";

import Character from "./Character";

export const link = createHttpLink({
  uri: "https://mpjk0plp9.lp.gql.zone/graphql"
});

export const client = new ApolloClient({
  cache: new InMemoryCache(),
  link,
});

export default () =>
  <ApolloProvider client={client}>
    // $ExpectError property `episode`. Property not found in. See: src/Character.js:43
    <Character />
  </ApolloProvider>;
```

### Props

One of the most powerful feature of the React integration is the `props` function which allows you to reshape the result data from an operation into a new shape of props for the wrapped component. GraphQL is awesome at allowing you to only request the data you want from the server. The client still often needs to reshape or do client side calculations based on these results. The return value can even differ depending on the state of the operation (i.e loading, error, received data), so informing our type system of choice of these possible values is really important to make sure our components won't have runtime errors.

The `graphql` wrapper from `@apollo/react-hoc` supports manually declaring the shape of your result props.

```tsx
import React from "react";
import { gql } from "@apollo/client";
import { graphql, ChildDataProps } from "@apollo/react-hoc";

const HERO_QUERY = gql`
  query GetCharacter($episode: Episode!) {
    hero(episode: $episode) {
      name
      id
      friends {
        name
        id
        appearsIn
      }
    }
  }
`;

type Hero = {
  name: string;
  id: string;
  appearsIn: string[];
  friends: Hero[];
};

type Response = {
  hero: Hero;
};

type InputProps = {
  episode: string
};

type Variables = {
  episode: string
};

type ChildProps = ChildDataProps<InputProps, Response, Variables>;

const withCharacter = graphql<InputProps, Response, Variables, ChildProps>(HERO_QUERY, {
  options: ({ episode }) => ({
    variables: { episode }
  }),
  props: ({ data }) => ({ ...data })
});

export default withCharacter(({ loading, hero, error }) => {
  if (loading) return <div>Loading</div>;
  if (error) return <h1>ERROR</h1>;
  return ...// actual component with data;
});
```

Since we have typed the response shape, the props shape, and the shape of what will be passed to the client, we can prevent errors in multiple places. Our options and props function within the `graphql` wrapper are now type safe, our rendered component is protected, and our tree of components have their required props enforced.

```ts
export const withCharacter = graphql<InputProps, Response, Variables, Props>(HERO_QUERY, {
  options: ({ episode }) => ({
    variables: { episode }
  }),
  props: ({ data, ownProps }) => ({
    ...data,
    // $ExpectError [string] This type cannot be compared to number
    episode: ownProps.episode > 1,
    // $ExpectError property `isHero`. Property not found on object type
    isHero: data && data.hero && data.hero.isHero
  })
});
```

With this addition, the entirety of the integration between Apollo and React can be statically typed. When combined with the strong tooling each system provides, it can make for a much improved application and developer experience.

### Classes vs Functions

All of the above examples show wrapping a component which is just a function using the result of a `graphql` wrapper. Sometimes, components that depend on GraphQL data require state and are formed using the `class MyComponent extends React.Component` practice. In these use cases, TypeScript requires adding prop shape to the class instance. In order to support this, `@apollo/react-hoc` exports types to support creating result types easily.

```tsx
import { ChildProps } from "@apollo/react-hoc";

const withCharacter = graphql<InputProps, Response>(HERO_QUERY, {
  options: ({ episode }) => ({
    variables: { episode }
  })
});

class Character extends React.Component<ChildProps<InputProps, Response>, {}> {
  render(){
    const { loading, hero, error } = this.props.data;
    if (loading) return <div>Loading</div>;
    if (error) return <h1>ERROR</h1>;
    return ...// actual component with data;
  }
}

export default withCharacter(Character);
```

### Using the `name` property

If you are using the `name` property in the configuration of the `graphql` wrapper, you will need to manually attach the type of the response to the `props` function. An example using TypeScript would be like this:

```ts
import { NamedProps, QueryProps } from '@apollo/react-hoc';

export const withCharacter = graphql<InputProps, Response, {}, Prop>(HERO_QUERY, {
  name: 'character',
  props: ({ character, ownProps }: NamedProps<{ character: QueryProps & Response }, Props) => ({
    ...character,
    // $ExpectError [string] This type cannot be compared to number
    episode: ownProps.episode > 1,
    // $ExpectError property `isHero`. Property not found on object type
    isHero: character && character.hero && character.hero.isHero
  })
});
```
