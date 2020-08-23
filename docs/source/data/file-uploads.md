---
title: File uploads
description: Enabling file uploads in Apollo Client
---

Apollo Boost doesn't support upload feature out of the box. If you'd like to enable upload, you will have to set Apollo Client up manually. Follow [this instruction](https://www.apollographql.com/docs/react/migrating/boost-migration) to migrate from Apollo Boost.

Then you need to add this dependency [apollo-upload-client](https://github.com/jaydenseric/apollo-upload-client)

```bash
npm install apollo-upload-client
```

Basic setup for the Apollo Client:

```js
const { ApolloClient } = require('apollo-client')
const { InMemoryCache } = require('apollo-cache-inmemory')
const { createUploadLink } = require('apollo-upload-client')

const client = new ApolloClient({
  cache: new InMemoryCache(),
  link: createUploadLink()
})
```

Detailed instructions on how to setup client can be found here: [https://github.com/jaydenseric/apollo-upload-client](https://github.com/jaydenseric/apollo-upload-client).
