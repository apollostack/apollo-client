import { ApolloCache, ApolloClient } from '../../core';
import { ApolloError } from '../../errors';
import {
  ApolloQueryResult,
  OperationVariables,
  FetchMoreOptions,
  UpdateQueryOptions,
  FetchMoreQueryOptions,
  SubscribeToMoreOptions,
  DefaultContext,
} from '../../core';
import {
  MutationFunction,
  BaseQueryOptions,
  BaseMutationOptions,
  MutationResult
} from '../types/types';

export interface QueryControls<
  TData = any,
  TGraphQLVariables = OperationVariables
> {
  error?: ApolloError;
  networkStatus: number;
  loading: boolean;
  variables: TGraphQLVariables;
  fetchMore: (
    fetchMoreOptions: FetchMoreQueryOptions<TGraphQLVariables, TData> &
      FetchMoreOptions<TData, TGraphQLVariables>
  ) => Promise<ApolloQueryResult<TData>>;
  refetch: (variables?: TGraphQLVariables) => Promise<ApolloQueryResult<TData>>;
  startPolling: (pollInterval: number) => void;
  stopPolling: () => void;
  subscribeToMore: (options: SubscribeToMoreOptions) => () => void;
  updateQuery: (
    mapFn: (previousQueryResult: any, options: UpdateQueryOptions<any>) => any
  ) => void;
}

export type DataValue<
  TData,
  TGraphQLVariables = OperationVariables
> = QueryControls<TData, TGraphQLVariables> &
  // data may not yet be loaded
  Partial<TData>;

export interface DataProps<TData, TGraphQLVariables = OperationVariables> {
  data: DataValue<TData, TGraphQLVariables>;
}

export interface MutateProps<
  TData = any,
  TGraphQLVariables = OperationVariables
> {
  mutate: MutationFunction<TData, TGraphQLVariables>;
  result: MutationResult<TData>;
}

export type ChildProps<
  TProps = {},
  TData = {},
  TGraphQLVariables = OperationVariables
> = TProps &
  Partial<DataProps<TData, TGraphQLVariables>> &
  Partial<MutateProps<TData, TGraphQLVariables>>;

export type ChildDataProps<
  TProps = {},
  TData = {},
  TGraphQLVariables = OperationVariables
> = TProps & DataProps<TData, TGraphQLVariables>;

export type ChildMutateProps<
  TProps = {},
  TData = {},
  TGraphQLVariables = OperationVariables
> = TProps & MutateProps<TData, TGraphQLVariables>;

export interface OptionProps<
  TProps = any,
  TData = any,
  TGraphQLVariables = OperationVariables
>
  extends Partial<DataProps<TData, TGraphQLVariables>>,
    Partial<MutateProps<TData, TGraphQLVariables>> {
  ownProps: TProps;
}

export interface OperationOption<
  TProps,
  TData,
  TGraphQLVariables = OperationVariables,
  TChildProps = ChildProps<TProps, TData, TGraphQLVariables>,
  TContext = DefaultContext,
  TCache extends ApolloCache<any> = ApolloCache<any>,
> {
  options?:
    | BaseQueryOptions<TGraphQLVariables>
    | BaseMutationOptions<TData, TGraphQLVariables, TContext, TCache>
    | ((
        props: TProps
      ) =>
        | BaseQueryOptions<TGraphQLVariables>
        | BaseMutationOptions<TData, TGraphQLVariables, TContext, TCache>
      );
  props?: (
    props: OptionProps<TProps, TData, TGraphQLVariables>,
    lastProps?: TChildProps | void
  ) => TChildProps;
  skip?: boolean | ((props: TProps) => boolean);
  name?: string;
  withRef?: boolean;
  shouldResubscribe?: (props: TProps, nextProps: TProps) => boolean;
  alias?: string;
}

export type WithApolloClient<P> = P & { client?: ApolloClient<any> };
