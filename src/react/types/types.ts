import { ReactNode } from 'react';
import { DocumentNode } from 'graphql';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';

import { Observable } from '../../utilities';
import { FetchResult } from '../../link/core';
import { ApolloClient } from '../../core';
import { ApolloError } from '../../errors';
import {
  ApolloQueryResult,
  ErrorPolicy,
  FetchMoreOptions,
  FetchMoreQueryOptions,
  FetchPolicy,
  MutationUpdaterFn,
  NetworkStatus,
  ObservableQuery,
  OperationVariables,
  PureQueryOptions,
  WatchQueryFetchPolicy,
} from '../../core';

/* Common types */

export type Context = Record<string, any>;

export type CommonOptions<TOptions> = TOptions & {
  client?: ApolloClient<object>;
};

/* Query types */

export interface BaseQueryOptions<TVariables = OperationVariables> {
  ssr?: boolean;
  variables?: TVariables;
  fetchPolicy?: WatchQueryFetchPolicy;
  nextFetchPolicy?: WatchQueryFetchPolicy;
  errorPolicy?: ErrorPolicy;
  pollInterval?: number;
  client?: ApolloClient<any>;
  notifyOnNetworkStatusChange?: boolean;
  context?: Context;
  partialRefetch?: boolean;
  returnPartialData?: boolean;
}

export interface QueryFunctionOptions<
  TData = any,
  TVariables = OperationVariables
> extends BaseQueryOptions<TVariables> {
  displayName?: string;
  skip?: boolean;
  onCompleted?: (data: TData) => void;
  onError?: (error: ApolloError) => void;
}

export type ObservableQueryFields<TData, TVariables> = Pick<
  ObservableQuery<TData, TVariables>,
  | 'startPolling'
  | 'stopPolling'
  | 'subscribeToMore'
  | 'updateQuery'
  | 'refetch'
  | 'variables'
> & {
  fetchMore: (<K extends keyof TVariables>(
    fetchMoreOptions: FetchMoreQueryOptions<TVariables, K, TData> &
      FetchMoreOptions<TData, TVariables>
  ) => Promise<ApolloQueryResult<TData>>) &
    (<TData2, TVariables2, K extends keyof TVariables2>(
      fetchMoreOptions: { query?: DocumentNode | TypedDocumentNode<TData, TVariables> } & FetchMoreQueryOptions<
        TVariables2,
        K,
        TData
      > &
        FetchMoreOptions<TData2, TVariables2>
    ) => Promise<ApolloQueryResult<TData2>>);
};

export interface QueryResult<TData = any, TVariables = OperationVariables>
  extends ObservableQueryFields<TData, TVariables> {
  client: ApolloClient<any>;
  data: TData | undefined;
  previousData?: TData;
  error?: ApolloError;
  loading: boolean;
  networkStatus: NetworkStatus;
  called: true;
}

export interface QueryDataOptions<TData = any, TVariables = OperationVariables>
  extends QueryFunctionOptions<TData, TVariables> {
  children?: (result: QueryResult<TData, TVariables>) => ReactNode;
  query: DocumentNode | TypedDocumentNode<TData, TVariables>;
}

export interface QueryHookOptions<TData = any, TVariables = OperationVariables>
  extends QueryFunctionOptions<TData, TVariables> {
  query?: DocumentNode | TypedDocumentNode<TData, TVariables>;
}

export interface LazyQueryHookOptions<
  TData = any,
  TVariables = OperationVariables
> extends Omit<QueryFunctionOptions<TData, TVariables>, 'skip'> {
  query?: DocumentNode | TypedDocumentNode<TData, TVariables>;
}

export interface QueryLazyOptions<TVariables> {
  variables?: TVariables;
  context?: Context;
}

type UnexecutedLazyFields = {
  loading: false;
  networkStatus: NetworkStatus.ready;
  called: false;
  data: undefined;
  previousData?: undefined;
}

type Impartial<T> = {
  [P in keyof T]?: never;
}

type AbsentLazyResultFields =
  Omit<
    Impartial<QueryResult<unknown, unknown>>,
    keyof UnexecutedLazyFields>

type UnexecutedLazyResult =
   UnexecutedLazyFields & AbsentLazyResultFields

export type LazyQueryResult<TData, TVariables> =
  | UnexecutedLazyResult
  | QueryResult<TData, TVariables>;

export type QueryTuple<TData, TVariables> = [
  (options?: QueryLazyOptions<TVariables>) => void,
  LazyQueryResult<TData, TVariables>
];

/* Mutation types */

export type RefetchQueriesFunction<TData> = (
  result: FetchResult<TData>
) => Array<string | PureQueryOptions>;

export interface BaseMutationOptions<
  TData = any,
  TVariables = OperationVariables
> {
  variables?: TVariables;
  optimisticResponse?: TData | ((vars: TVariables) => TData);
  refetchQueries?: Array<string | PureQueryOptions> | RefetchQueriesFunction<TData>;
  awaitRefetchQueries?: boolean;
  errorPolicy?: ErrorPolicy;
  update?: MutationUpdaterFn<TData>;
  client?: ApolloClient<object>;
  notifyOnNetworkStatusChange?: boolean;
  context?: Context;
  onCompleted?: (data: TData) => void;
  onError?: (error: ApolloError) => void;
  fetchPolicy?: Extract<WatchQueryFetchPolicy, 'no-cache'>;
  ignoreResults?: boolean;
}

export interface MutationFunctionOptions<
  TData = any,
  TVariables = OperationVariables
> {
  variables?: TVariables;
  optimisticResponse?: TData | ((vars: TVariables) => TData);
  refetchQueries?: Array<string | PureQueryOptions> | RefetchQueriesFunction<TData>;
  awaitRefetchQueries?: boolean;
  update?: MutationUpdaterFn<TData>;
  context?: Context;
  fetchPolicy?: WatchQueryFetchPolicy;
}

export interface MutationResult<TData = any> {
  data?: TData | null;
  error?: ApolloError;
  loading: boolean;
  called: boolean;
  client: ApolloClient<object>;
}

export declare type MutationFunction<
  TData = any,
  TVariables = OperationVariables
> = (
  options?: MutationFunctionOptions<TData, TVariables>
) => Promise<FetchResult<TData>>;

export interface MutationHookOptions<
  TData = any,
  TVariables = OperationVariables
> extends BaseMutationOptions<TData, TVariables> {
  mutation?: DocumentNode | TypedDocumentNode<TData, TVariables>;
}

export interface MutationDataOptions<TData = any, TVariables = OperationVariables>
  extends BaseMutationOptions<TData, TVariables> {
  mutation: DocumentNode | TypedDocumentNode<TData, TVariables>;
}

export type MutationTuple<TData, TVariables> = [
  (
    options?: MutationFunctionOptions<TData, TVariables>
  ) => Promise<FetchResult<TData>>,
  MutationResult<TData>
];

/* Subscription types */

export interface OnSubscriptionDataOptions<TData = any> {
  client: ApolloClient<object>;
  subscriptionData: SubscriptionResult<TData>;
}

export interface BaseSubscriptionOptions<
  TData = any,
  TVariables = OperationVariables
> {
  variables?: TVariables;
  fetchPolicy?: FetchPolicy;
  shouldResubscribe?:
    | boolean
    | ((options: BaseSubscriptionOptions<TData, TVariables>) => boolean);
  client?: ApolloClient<object>;
  skip?: boolean;
  context?: Context;
  onSubscriptionData?: (options: OnSubscriptionDataOptions<TData>) => any;
  onSubscriptionComplete?: () => void;
}

export interface SubscriptionResult<TData = any> {
  loading: boolean;
  data?: TData;
  error?: ApolloError;
}

export interface SubscriptionHookOptions<
  TData = any,
  TVariables = OperationVariables
> extends BaseSubscriptionOptions<TData, TVariables> {
  subscription?: DocumentNode | TypedDocumentNode<TData, TVariables>;
}

export interface SubscriptionDataOptions<
  TData = any,
  TVariables = OperationVariables
> extends BaseSubscriptionOptions<TData, TVariables> {
  subscription: DocumentNode | TypedDocumentNode<TData, TVariables>;
  children?: null | ((result: SubscriptionResult<TData>) => JSX.Element | null);
}

export interface SubscriptionCurrentObservable {
  query?: Observable<any>;
  subscription?: ZenObservable.Subscription;
}
