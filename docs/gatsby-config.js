const themeOptions = require('gatsby-theme-apollo-docs/theme-options');

module.exports = {
  pathPrefix: '/docs/react',
  plugins: [
    {
      resolve: 'gatsby-theme-apollo-docs',
      options: {
        ...themeOptions,
        root: __dirname,
        subtitle: 'Client (React)',
        description: 'A guide to using the Apollo GraphQL Client with React',
        githubRepo: 'apollographql/apollo-client',
        defaultVersion: '3',
        versions: {
          '2': 'version-2.6',
        },
        checkLinksOptions: {
          exceptions: [
            '/api/core/ApolloClient/',
            '/v2/api/apollo-client/',
          ],
        },
        sidebarCategories: {
          null: [
            'index',
            'why-apollo',
            'get-started',
            '[Changelog](https://github.com/apollographql/apollo-client/blob/main/CHANGELOG.md)',
          ],
          'Fetching': [
            'data/queries',
            'data/mutations',
            'data/subscriptions',
            'data/fragments',
            'data/error-handling',
            'data/operation-best-practices'
          ],
          Caching: [
            'caching/cache-configuration',
            'caching/cache-interaction',
            'caching/garbage-collection',
            'caching/cache-field-behavior',
            'caching/advanced-topics'
          ],
          Pagination: [
            'pagination/overview',
            'pagination/core-api',
            'pagination/offset-based',
            'pagination/cursor-based',
            'pagination/key-args'
          ],
          'Local State': [
            'local-state/local-state-management',
            'local-state/managing-state-with-field-policies',
            'local-state/reactive-variables',
            'local-state/client-side-schema',
            'local-state/local-resolvers'
          ],
          'Development & Testing': [
            'development-testing/developer-tooling',
            'development-testing/static-typing',
            'development-testing/testing',
            'development-testing/client-schema-mocking',
          ],
          Performance: [
            'performance/performance',
            'performance/optimistic-ui',
            'performance/server-side-rendering',
            'performance/babel',
          ],
          Integrations: [
            'integrations/integrations',
            'integrations/react-native',
            'integrations/webpack',
          ],
          Networking: [
            'networking/basic-http-networking',
            'networking/advanced-http-networking',
            'networking/authentication',
          ],
          Migrating: [
            'migrating/apollo-client-3-migration',
            'migrating/hooks-migration'
          ],
          'API - Core': [
            'api/core/ApolloClient',
            'api/cache/InMemoryCache',
            'api/core/ObservableQuery'
          ],
          'API - React': [
            'api/react/hooks',
            'api/react/testing',
            'api/react/ssr',
            'api/react/components',
            'api/react/hoc'
          ],
          'API - Link': [
            'api/link/introduction',
            'api/link/apollo-link-http',
            'api/link/apollo-link-batch-http',
            'api/link/apollo-link-context',
            'api/link/apollo-link-error',
            'api/link/persisted-queries',
            'api/link/apollo-link-rest',
            'api/link/apollo-link-retry',
            'api/link/apollo-link-schema',
            'api/link/apollo-link-ws',
            'api/link/community-links'
          ],
        },
      },
    },
  ],
};
