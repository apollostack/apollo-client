import React from 'react';
import { ApolloClient } from '../../core';
import { canUseWeakMap } from '../../utilities';

export interface ApolloContextValue {
  client?: ApolloClient<object>;
  renderPromises?: Record<any, any>;
}

// To make sure Apollo Client doesn't create more than one React context
// (which can lead to problems like having an Apollo Client instance added
// in one context, then attempting to retrieve it from another different
// context), a single Apollo context is created and tracked in global state.
// We use React.createContext as the key instead of just React to avoid
// ambiguities between default and namespace React imports.

const cache = new (canUseWeakMap ? WeakMap : Map)<
  typeof React.createContext,
  React.Context<ApolloContextValue>
>();

export function getApolloContext() {
  let context = cache.get(React.createContext)!;
  if (!context) {
    context = React.createContext<ApolloContextValue>({});
    context.displayName = 'ApolloContext';
    cache.set(React.createContext, context);
  }
  return context;
}

export { getApolloContext as resetApolloContext }
