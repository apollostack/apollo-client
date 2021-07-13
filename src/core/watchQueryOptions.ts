import { DocumentNode } from 'graphql';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';

import { FetchResult } from '../link/core';
import {
  DefaultContext,
  MutationQueryReducersMap,
  OperationVariables,
  MutationUpdaterFunction,
  OnQueryUpdated,
  InternalRefetchQueriesInclude,
} from './types';
import { ApolloCache } from '../cache';

/**
 * fetchPolicy determines where the client may return a result from. The options are:
 * - cache-first (default): return result from cache. Only fetch from network if cached result is not available.
 * - cache-and-network: return result from cache first (if it exists), then return network result once it's available.
 * - cache-only: return result from cache if available, fail otherwise.
 * - no-cache: return result from network, fail if network call doesn't succeed, don't save to cache
 * - network-only: return result from network, fail if network call doesn't succeed, save to cache
 * - standby: only for queries that aren't actively watched, but should be available for refetch and updateQueries.
 */
export type FetchPolicy =
  | 'cache-first'
  | 'network-only'
  | 'cache-only'
  | 'no-cache'
  | 'standby';

export type WatchQueryFetchPolicy = FetchPolicy | 'cache-and-network';

export type RefetchWritePolicy = "merge" | "overwrite";

/**
 * errorPolicy determines the level of events for errors in the execution result. The options are:
 * - none (default): any errors from the request are treated like runtime errors and the observable is stopped (XXX this is default to lower breaking changes going from AC 1.0 => 2.0)
 * - ignore: errors from the request do not stop the observable, but also don't call `next`
 * - all: errors are treated like data and will notify observables
 */
export type ErrorPolicy = 'none' | 'ignore' | 'all';

/**
 * Query options.
 */
export interface QueryOptions<TVariables = OperationVariables, TData = any> {
  /**
   * A GraphQL document that consists of a single query to be sent down to the
   * server.
   */
  // TODO REFACTOR: rename this to document. Didn't do it yet because it's in a
  // lot of tests.
  query: DocumentNode | TypedDocumentNode<TData, TVariables>;

  /**
   * A map going from variable name to variable value, where the variables are used
   * within the GraphQL query.
   */
  variables?: TVariables;

  /**
   * Specifies the {@link ErrorPolicy} to be used for this query
   */
  errorPolicy?: ErrorPolicy;

  /**
   * Context to be passed to link execution chain
   */
  context?: any;

  /**
   * Specifies the {@link FetchPolicy} to be used for this query
   */
  fetchPolicy?: FetchPolicy;

  /**
   * The time interval (in milliseconds) on which this query should be
   * refetched from the server.
   */
  pollInterval?: number;

  /**
   * Whether or not updates to the network status should trigger next on the observer of this query
   */
  notifyOnNetworkStatusChange?: boolean;

  /**
   * Allow returning incomplete data from the cache when a larger query cannot
   * be fully satisfied by the cache, instead of returning nothing.
   */
  returnPartialData?: boolean;

  /**
   * If `true`, perform a query `refetch` if the query result is marked as
   * being partial, and the returned data is reset to an empty Object by the
   * Apollo Client `QueryManager` (due to a cache miss).
   */
  partialRefetch?: boolean;

  /**
   * Whether to canonize cache results before returning them. Canonization
   * takes some extra time, but it speeds up future deep equality comparisons.
   * Defaults to true.
   */
  canonizeResults?: boolean;
}

/**
 * Watched query options.
 */
export interface WatchQueryOptions<TVariables = OperationVariables, TData = any>
  extends Omit<QueryOptions<TVariables, TData>, 'fetchPolicy'> {
  /**
   * Specifies the {@link FetchPolicy} to be used for this query.
   */
  fetchPolicy?: WatchQueryFetchPolicy;
  /**
   * Specifies the {@link FetchPolicy} to be used after this query has completed.
   */
  nextFetchPolicy?: WatchQueryFetchPolicy | ((
    this: WatchQueryOptions<TVariables, TData>,
    lastFetchPolicy: WatchQueryFetchPolicy,
  ) => WatchQueryFetchPolicy);
  /**
   * Specifies whether a {@link NetworkStatus.refetch} operation should merge
   * incoming field data with existing data, or overwrite the existing data.
   * Overwriting is probably preferable, but merging is currently the default
   * behavior, for backwards compatibility with Apollo Client 3.x.
   */
  refetchWritePolicy?: RefetchWritePolicy;
}

export interface FetchMoreQueryOptions<TVariables, TData = any> {
  query?: DocumentNode | TypedDocumentNode<TData, TVariables>;
  variables?: Partial<TVariables>;
  context?: any;
}

export type UpdateQueryFn<
  TData = any,
  TSubscriptionVariables = OperationVariables,
  TSubscriptionData = TData
> = (
  previousQueryResult: TData,
  options: {
    subscriptionData: { data: TSubscriptionData };
    variables?: TSubscriptionVariables;
  },
) => TData;

export type SubscribeToMoreOptions<
  TData = any,
  TSubscriptionVariables = OperationVariables,
  TSubscriptionData = TData
> = {
  document: DocumentNode | TypedDocumentNode<TSubscriptionData, TSubscriptionVariables>;
  variables?: TSubscriptionVariables;
  updateQuery?: UpdateQueryFn<TData, TSubscriptionVariables, TSubscriptionData>;
  onError?: (error: Error) => void;
  context?: DefaultContext;
};

export interface SubscriptionOptions<TVariables = OperationVariables, TData = any> {
  /**
   * A GraphQL document, often created with `gql` from the `graphql-tag`
   * package, that contains a single subscription inside of it.
   */
  query: DocumentNode | TypedDocumentNode<TData, TVariables>;

  /**
   * An object that maps from the name of a variable as used in the subscription
   * GraphQL document to that variable's value.
   */
  variables?: TVariables;

  /**
   * Specifies the {@link FetchPolicy} to be used for this subscription.
   */
  fetchPolicy?: FetchPolicy;

  /**
   * Specifies the {@link ErrorPolicy} to be used for this operation
   */
  errorPolicy?: ErrorPolicy;

  /**
   * Context object to be passed through the link execution chain.
   */
  context?: DefaultContext;
}

export interface MutationBaseOptions<
  TData = any,
  TVariables = OperationVariables,
  TContext = DefaultContext,
  TCache extends ApolloCache<any> = ApolloCache<any>,
> {
  /**
   * An object that represents the result of this mutation that will be
   * optimistically stored before the server has actually returned a result.
   * This is most often used for optimistic UI, where we want to be able to see
   * the result of a mutation immediately, and update the UI later if any errors
   * appear.
   */
  optimisticResponse?: TData | ((vars: TVariables) => TData);

  /**
   * A {@link MutationQueryReducersMap}, which is map from query names to
   * mutation query reducers. Briefly, this map defines how to incorporate the
   * results of the mutation into the results of queries that are currently
   * being watched by your application.
   */
  updateQueries?: MutationQueryReducersMap<TData>;

  /**
   * A list of query names which will be refetched once this mutation has
   * returned. This is often used if you have a set of queries which may be
   * affected by a mutation and will have to update. Rather than writing a
   * mutation query reducer (i.e. `updateQueries`) for this, you can simply
   * refetch the queries that will be affected and achieve a consistent store
   * once these queries return.
   */
  refetchQueries?:
    | ((result: FetchResult<TData>) => InternalRefetchQueriesInclude)
    | InternalRefetchQueriesInclude;

  /**
   * By default, `refetchQueries` does not wait for the refetched queries to
   * be completed, before resolving the mutation `Promise`. This ensures that
   * query refetching does not hold up mutation response handling (query
   * refetching is handled asynchronously). Set `awaitRefetchQueries` to
   * `true` if you would like to wait for the refetched queries to complete,
   * before the mutation can be marked as resolved.
   */
  awaitRefetchQueries?: boolean;

  /**
   * A function which provides an {@link ApolloCache} instance, and the result
   * of the mutation, to allow the user to update the store based on the
   * results of the mutation.
   *
   * This function will be called twice over the lifecycle of a mutation. Once
   * at the very beginning if an `optimisticResponse` was provided. The writes
   * created from the optimistic data will be rolled back before the second time
   * this function is called which is when the mutation has succesfully
   * resolved. At that point `update` will be called with the *actual* mutation
   * result and those writes will not be rolled back.
   *
   * Note that since this function is intended to be used to update the
   * store, it cannot be used with a `no-cache` fetch policy. If you're
   * interested in performing some action after a mutation has completed,
   * and you don't need to update the store, use the Promise returned from
   * `client.mutate` instead.
   */
  update?: MutationUpdaterFunction<TData, TVariables, TContext, TCache>;

  /**
   * A function that will be called for each ObservableQuery affected by
   * this mutation, after the mutation has completed.
   */
  onQueryUpdated?: OnQueryUpdated<any>;

  /**
   * Specifies the {@link ErrorPolicy} to be used for this operation
   */
  errorPolicy?: ErrorPolicy;

  /**
   * An object that maps from the name of a variable as used in the mutation
   * GraphQL document to that variable's value.
   */
  variables?: TVariables;

  /**
   * The context to be passed to the link execution chain. This context will
   * only be used with this mutation. It will not be used with
   * `refetchQueries`. Refetched queries use the context they were
   * initialized with (since the intitial context is stored as part of the
   * `ObservableQuery` instance). If a specific context is needed when
   * refetching queries, make sure it is configured (via the
   * [query `context` option](https://www.apollographql.com/docs/react/api/apollo-client#ApolloClient.query))
   * when the query is first initialized/run.
   */
   context?: TContext;
}

export interface MutationOptions<
  TData = any,
  TVariables = OperationVariables,
  TContext = DefaultContext,
  TCache extends ApolloCache<any> = ApolloCache<any>,
> extends MutationBaseOptions<TData, TVariables, TContext, TCache> {
  /**
   * A GraphQL document, often created with `gql` from the `graphql-tag`
   * package, that contains a single mutation inside of it.
   */
  mutation: DocumentNode | TypedDocumentNode<TData, TVariables>;

  /**
   * Specifies the {@link FetchPolicy} to be used for this query. Mutations only
   * support a 'no-cache' fetchPolicy. If you don't want to disable the cache,
   * remove your fetchPolicy setting to proceed with the default mutation
   * behavior.
   */
  fetchPolicy?: Extract<FetchPolicy, 'no-cache'>;

  /**
   * To avoid retaining sensitive information from mutation root field
   * arguments, Apollo Client v3.4+ automatically clears any `ROOT_MUTATION`
   * fields from the cache after each mutation finishes. If you need this
   * information to remain in the cache, you can prevent the removal by passing
   * `keepRootFields: true` to the mutation. `ROOT_MUTATION` result data are
   * also passed to the mutation `update` function, so we recommend obtaining
   * the results that way, rather than using this option, if possible.
   */
  keepRootFields?: boolean;
}
