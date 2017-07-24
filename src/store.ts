import {
  createStore,
  compose as reduxCompose,
  applyMiddleware,
  combineReducers,
  Middleware,
  Action,
} from 'redux';

import { FragmentMatcher } from 'graphql-anywhere';

import { NormalizedCache } from './data/storeUtils';

import { QueryStore } from './queries/store';

import {
  // mutations,
  MutationStore,
} from './mutations/store';

import {
  ApolloAction,
  isQueryResultAction,
  isMutationResultAction,
  isSubscriptionResultAction,
} from './actions';

import { IdGetter } from './core/types';

import { CustomResolverMap } from './data/readFromStore';

import { assign } from './util/assign';

export interface Store {}

/**
 * This is an interface that describes the behavior of a Apollo store, which is currently
 * implemented through redux.
 */
export interface ApolloStore {
  dispatch: (action: ApolloAction) => void;

  // We don't know what this will return because it could have any number of custom keys when
  // integrating with an existing store
  getState: () => any;
}

const crashReporter = (store: any) => (next: any) => (action: any) => {
  try {
    return next(action);
  } catch (err) {
    console.error('Caught an exception!', err);
    console.error(err.stack);
    throw err;
  }
};

// Reducer
export type ApolloReducer = (
  store: NormalizedCache,
  action: ApolloAction,
) => NormalizedCache;

export function createApolloReducer(
  config: ApolloReducerConfig,
): (state: Store, action: ApolloAction | Action) => Store {
  return function apolloReducer(state = {} as Store, action: ApolloAction) {
    // use the two lines below to debug tests :)
    // console.log('ACTION', action.type, JSON.stringify(action, null, 2));
    // console.log('new state', newState);

    return {};
  };
}

export function createApolloStore(
  {
    reduxRootKey = 'apollo',
    initialState,
    config = {},
    reportCrashes = true,
    logger,
  }: {
    reduxRootKey?: string;
    initialState?: any;
    config?: ApolloReducerConfig;
    reportCrashes?: boolean;
    logger?: Middleware;
  } = {},
): ApolloStore {
  const enhancers: any[] = [];
  const middlewares: Middleware[] = [];

  if (reportCrashes) {
    middlewares.push(crashReporter);
  }

  if (logger) {
    middlewares.push(logger);
  }

  if (middlewares.length > 0) {
    enhancers.push(applyMiddleware(...middlewares));
  }

  // Dev tools enhancer should be last
  if (typeof window !== 'undefined') {
    const anyWindow = window as any;
    if (anyWindow.devToolsExtension) {
      enhancers.push(anyWindow.devToolsExtension());
    }
  }

  // XXX to avoid type fail
  const compose: (...args: any[]) => () => any = reduxCompose;

  // Note: The below checks are what make it OK for QueryManager to start from 0 when generating
  // new query IDs. If we let people rehydrate query state for some reason, we would need to make
  // sure newly generated IDs don't overlap with old queries.
  if (
    initialState &&
    initialState[reduxRootKey] &&
    initialState[reduxRootKey]['queries']
  ) {
    throw new Error('Apollo initial state may not contain queries, only data');
  }

  if (
    initialState &&
    initialState[reduxRootKey] &&
    initialState[reduxRootKey]['mutations']
  ) {
    throw new Error(
      'Apollo initial state may not contain mutations, only data',
    );
  }

  return createStore(
    combineReducers({ [reduxRootKey]: createApolloReducer(config) }),
    initialState,
    compose(...enhancers),
  );
}

export type ApolloReducerConfig = {
  dataIdFromObject?: IdGetter;
  customResolvers?: CustomResolverMap;
  fragmentMatcher?: FragmentMatcher;
  addTypename?: boolean;
};
