import { ReactNode } from 'react';
import { DocumentNode } from 'graphql';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';

import { Observable } from '../../utilities';
import { FetchResult } from '../../link/core';
import { ApolloError } from '../../errors';
import {
  ApolloCache,
  ApolloClient,
  ApolloQueryResult,
  DefaultContext,
  FetchMoreOptions,
  FetchMoreQueryOptions,
  FetchPolicy,
  MutationOptions,
  NetworkStatus,
  ObservableQuery,
  OperationVariables,
  InternalRefetchQueriesInclude,
  WatchQueryOptions,
} from '../../core';

/* Common types */

export type { DefaultContext as Context } from "../../core";

export type CommonOptions<TOptions> = TOptions & {
  client?: ApolloClient<object>;
};

/* Query types */

export interface BaseQueryOptions<TVariables = OperationVariables>
extends Omit<WatchQueryOptions<TVariables>, "query"> {
  ssr?: boolean;
  client?: ApolloClient<any>;
  context?: DefaultContext;
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
  fetchMore: ((
    fetchMoreOptions: FetchMoreQueryOptions<TVariables, TData> &
      FetchMoreOptions<TData, TVariables>
  ) => Promise<ApolloQueryResult<TData>>) &
    (<TData2, TVariables2>(
      fetchMoreOptions: { query?: DocumentNode | TypedDocumentNode<TData, TVariables> } & FetchMoreQueryOptions<
        TVariables2,
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
  context?: DefaultContext;
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

export type RefetchQueriesFunction = (
  ...args: any[]
) => InternalRefetchQueriesInclude;

export interface BaseMutationOptions<
  TData,
  TVariables extends OperationVariables,
  TContext extends DefaultContext = DefaultContext,
  TCache extends ApolloCache<any> = ApolloCache<any>
> extends Omit<
  MutationOptions<TData, TVariables, TContext, TCache>,
  | "mutation"
> {
  client?: ApolloClient<object>;
  notifyOnNetworkStatusChange?: boolean;
  onCompleted?: (data: TData) => void;
  onError?: (error: ApolloError) => void;
  ignoreResults?: boolean;
}

export interface MutationFunctionOptions<
  TData,
  TVariables,
  TContext,
  TCache extends ApolloCache<any>,
> extends BaseMutationOptions<TData, TVariables, TContext, TCache> {
  mutation?: DocumentNode | TypedDocumentNode<TData, TVariables>;
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
  TVariables = OperationVariables,
  TContext = DefaultContext,
  TCache extends ApolloCache<any> = ApolloCache<any>,
> = (
  options?: MutationFunctionOptions<TData, TVariables, TContext, TCache>
) => Promise<FetchResult<TData>>;

export interface MutationHookOptions<
  TData = any,
  TVariables = OperationVariables,
  TContext = DefaultContext,
  TCache extends ApolloCache<any> = ApolloCache<any>,
> extends BaseMutationOptions<TData, TVariables, TContext, TCache> {
  mutation?: DocumentNode | TypedDocumentNode<TData, TVariables>;
}

export interface MutationDataOptions<
  TData,
  TVariables extends OperationVariables,
  TContext extends DefaultContext,
  TCache extends ApolloCache<any>,
> extends BaseMutationOptions<TData, TVariables, TContext, TCache> {
  mutation: DocumentNode | TypedDocumentNode<TData, TVariables>;
}

export type MutationTuple<TData, TVariables, TContext, TCache extends ApolloCache<any>> = [
  (
    options?: MutationFunctionOptions<TData, TVariables, TContext, TCache>
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
  context?: DefaultContext;
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
