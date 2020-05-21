import type { ApolloClient } from '../../ApolloClient';
import { requireReactLazily } from '../react';

export interface ApolloContextValue {
  client?: ApolloClient<object>;
  renderPromises?: Record<any, any>;
}

// To make sure Apollo Client doesn't create more than one React context
// (which can lead to problems like having an Apollo Client instance added
// in one context, then attempting to retrieve it from another different
// context), a single Apollo context is created and tracked in global state.
// Since the created context is React specific, we've decided to attach it to
// the `React` object for sharing.

// If Symbol's aren't available, we'll use a fallback string as the context
// property (we're looking at you, IE11).
const contextSymbol = typeof Symbol === 'function' && Symbol.for ?
  Symbol.for('__APOLLO_CONTEXT__') :
  '__APOLLO_CONTEXT__';

export function resetApolloContext() {
  const React = requireReactLazily();
  Object.defineProperty(React, contextSymbol, {
    value: React.createContext<ApolloContextValue>({}),
    enumerable: false,
    configurable: true,
    writable: false,
  });
}

export function getApolloContext() {
  const React = requireReactLazily();
  if (!(React as any)[contextSymbol]) {
    resetApolloContext();
  }
  return (React as any)[contextSymbol] as React.Context<ApolloContextValue>;
}
