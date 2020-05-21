import type { DocumentNode } from 'graphql';

import { ApolloClient } from '../../../ApolloClient';
import { InMemoryCache } from '../../../cache/inmemory/inMemoryCache';
import type { NormalizedCacheObject } from '../../../cache/inmemory/types';
import { mockSingleLink } from '../../../utilities/testing/mocking/mockLink';

export function createMockClient<TData>(
  data: TData,
  query: DocumentNode,
  variables = {},
): ApolloClient<NormalizedCacheObject> {
  return new ApolloClient({
    link: mockSingleLink({
      request: { query, variables },
      result: { data },
    }).setOnError(error => { throw error }),
    cache: new InMemoryCache({ addTypename: false }),
  });
}
