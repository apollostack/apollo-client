import { DocumentNode, GraphQLError } from 'graphql';

import { ApolloCache } from '../cache';
import { FetchResult } from '../link/core';
import { ApolloError } from '../errors';
import { QueryInfo } from './QueryInfo';
import { NetworkStatus } from './networkStatus';
import { Resolver } from './LocalState';
import { ObservableQuery } from './ObservableQuery';
import { QueryOptions } from './watchQueryOptions';
import { Cache } from '../cache';
import { IsStrictlyAny } from '../utilities';

export { TypedDocumentNode } from '@graphql-typed-document-node/core';

export type DefaultContext = Record<string, any>;

export type QueryListener = (queryInfo: QueryInfo) => void;

export type OnQueryUpdated<TResult> = (
  observableQuery: ObservableQuery<any>,
  diff: Cache.DiffResult<any>,
  lastDiff: Cache.DiffResult<any> | undefined,
) => boolean | TResult;

export type RefetchQueryDescriptor = string | DocumentNode;
export type InternalRefetchQueryDescriptor = RefetchQueryDescriptor | QueryOptions;

type RefetchQueriesIncludeShorthand = "all" | "active";

export type RefetchQueriesInclude =
  | RefetchQueryDescriptor[]
  | RefetchQueriesIncludeShorthand;

export type InternalRefetchQueriesInclude =
  | InternalRefetchQueryDescriptor[]
  | RefetchQueriesIncludeShorthand;

// Used by ApolloClient["refetchQueries"]
// TODO Improve documentation comments for this public type.
export interface RefetchQueriesOptions<
  TCache extends ApolloCache<any>,
  TResult,
> {
  updateCache?: (cache: TCache) => void;
  // The client.refetchQueries method discourages passing QueryOptions, by
  // restricting the public type of options.include to exclude QueryOptions as
  // an available array element type (see InternalRefetchQueriesInclude for a
  // version of RefetchQueriesInclude that allows legacy QueryOptions objects).
  include?: RefetchQueriesInclude;
  optimistic?: boolean;
  // If no onQueryUpdated function is provided, any queries affected by the
  // updateCache function or included in the options.include array will be
  // refetched by default. Passing null instead of undefined disables this
  // default refetching behavior for affected queries, though included queries
  // will still be refetched.
  onQueryUpdated?: OnQueryUpdated<TResult> | null;
}

// The client.refetchQueries method returns a thenable (PromiseLike) object
// whose result is an array of Promise.resolve'd TResult values, where TResult
// is whatever type the (optional) onQueryUpdated function returns. When no
// onQueryUpdated function is given, TResult defaults to ApolloQueryResult<any>
// (thanks to default type parameters for client.refetchQueries).
export type RefetchQueriesPromiseResults<TResult> =
  // If onQueryUpdated returns any, all bets are off, so the results array must
  // be a generic any[] array, which is much less confusing than the union type
  // we get if we don't check for any. I hoped `any extends TResult` would do
  // the trick here, instead of IsStrictlyAny, but you can see for yourself what
  // fails in the refetchQueries tests if you try making that simplification.
  IsStrictlyAny<TResult> extends true ? any[] :
  // If the onQueryUpdated function passed to client.refetchQueries returns true
  // or false, that means either to refetch the query (true) or to skip the
  // query (false). Since refetching produces an ApolloQueryResult<any>, and
  // skipping produces nothing, the fully-resolved array of all results produced
  // will be an ApolloQueryResult<any>[], when TResult extends boolean.
  TResult extends boolean ? ApolloQueryResult<any>[] :
  // If onQueryUpdated returns a PromiseLike<U>, that thenable will be passed as
  // an array element to Promise.all, so we infer/unwrap the array type U here.
  TResult extends PromiseLike<infer U> ? U[] :
  // All other onQueryUpdated results end up in the final Promise.all array as
  // themselves, with their original TResult type. Note that TResult will
  // default to ApolloQueryResult<any> if no onQueryUpdated function is passed
  // to client.refetchQueries.
  TResult[];

// The result of client.refetchQueries is thenable/awaitable, if you just want
// an array of fully resolved results, but you can also access the raw results
// immediately by examining the additional { queries, results } properties of
// the RefetchQueriesResult<TResult> object.
export interface RefetchQueriesResult<TResult>
extends Promise<RefetchQueriesPromiseResults<TResult>> {
  // An array of ObservableQuery objects corresponding 1:1 to TResult values
  // in the results arrays (both the TResult[] array below, and the results
  // array resolved by the Promise above).
  queries: ObservableQuery<any>[];
  // These are the raw TResult values returned by any onQueryUpdated functions
  // that were invoked by client.refetchQueries.
  results: InternalRefetchQueriesResult<TResult>[];
}

// Used by QueryManager["refetchQueries"]
export interface InternalRefetchQueriesOptions<
  TCache extends ApolloCache<any>,
  TResult,
> extends Omit<RefetchQueriesOptions<TCache, TResult>, "include"> {
  // Just like the refetchQueries option for a mutation, an array of strings,
  // DocumentNode objects, and/or QueryOptions objects, or one of the shorthand
  // strings "all" or "active", to select every (active) query.
  include?: InternalRefetchQueriesInclude;
  // This part of the API is a (useful) implementation detail, but need not be
  // exposed in the public client.refetchQueries API (above).
  removeOptimistic?: string;
}

export type InternalRefetchQueriesResult<TResult> =
  TResult | Promise<ApolloQueryResult<any>>;

export type InternalRefetchQueriesMap<TResult> =
  Map<ObservableQuery<any>,
      InternalRefetchQueriesResult<TResult>>;

// TODO Remove this unnecessary type in Apollo Client 4.
export type { QueryOptions as PureQueryOptions };

export type OperationVariables = Record<string, any>;

export type ApolloQueryResult<T> = {
  data: T;
  errors?: ReadonlyArray<GraphQLError>;
  error?: ApolloError;
  loading: boolean;
  networkStatus: NetworkStatus;
  // If result.data was read from the cache with missing fields,
  // result.partial will be true. Otherwise, result.partial will be falsy
  // (usually because the property is absent from the result object).
  partial?: boolean;
};

// This is part of the public API, people write these functions in `updateQueries`.
export type MutationQueryReducer<T> = (
  previousResult: Record<string, any>,
  options: {
    mutationResult: FetchResult<T>;
    queryName: string | undefined;
    queryVariables: Record<string, any>;
  },
) => Record<string, any>;

export type MutationQueryReducersMap<T = { [key: string]: any }> = {
  [queryName: string]: MutationQueryReducer<T>;
};

export type MutationUpdaterFunction<
  TData,
  TVariables,
  TContext,
  TCache extends ApolloCache<any>
> = (
  cache: TCache,
  result: Omit<FetchResult<TData>, 'context'>,
  options: {
    context?: TContext,
    variables?: TVariables,
  },
) => void;
export interface Resolvers {
  [key: string]: {
    [ field: string ]: Resolver;
  };
}
