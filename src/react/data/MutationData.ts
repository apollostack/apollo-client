import { equal } from '@wry/equality';

import { DocumentType } from '../parser';
import { ApolloError } from '../../errors';
import {
  MutationDataOptions,
  MutationTuple,
  MutationFunctionOptions,
  MutationResult,
} from '../types/types';
import { OperationData } from './OperationData';
import { MutationOptions, mergeOptions, ApolloCache, OperationVariables, DefaultContext } from '../../core';
import { FetchResult } from '../../link/core';

type MutationResultWithoutClient<TData = any> = Omit<MutationResult<TData>, 'client'>;

export class MutationData<
  TData = any,
  TVariables = OperationVariables,
  TContext = DefaultContext,
  TCache extends ApolloCache<any> = ApolloCache<any>,
> extends OperationData<MutationDataOptions<TData, TVariables, TContext, TCache>> {
  private mostRecentMutationId: number;
  private result: MutationResultWithoutClient<TData>;
  private previousResult?: MutationResultWithoutClient<TData>;
  private setResult: (result: MutationResultWithoutClient<TData>) => any;

  constructor({
    options,
    context,
    result,
    setResult
  }: {
    options: MutationDataOptions<TData, TVariables, TContext, TCache>;
    context: any;
    result: MutationResultWithoutClient<TData>;
    setResult: (result: MutationResultWithoutClient<TData>) => any;
  }) {
    super(options, context);
    this.verifyDocumentType(options.mutation, DocumentType.Mutation);
    this.result = result;
    this.setResult = setResult;
    this.mostRecentMutationId = 0;
  }

  public execute(result: MutationResultWithoutClient<TData>): MutationTuple<TData, TVariables, TContext, TCache> {
    this.isMounted = true;
    this.verifyDocumentType(this.getOptions().mutation, DocumentType.Mutation);
    return [
      this.runMutation,
      { ...result, client: this.refreshClient().client }
    ] as MutationTuple<TData, TVariables, TContext, TCache>;
  }

  public afterExecute() {
    this.isMounted = true;
    return this.unmount.bind(this);
  }

  public cleanup() {
    // No cleanup required.
  }

  private runMutation = (
    mutationFunctionOptions: MutationFunctionOptions<
      TData,
      TVariables,
      TContext,
      TCache
    > = {} as MutationFunctionOptions<TData, TVariables, TContext, TCache>
  ) => {
    this.onMutationStart();
    const mutationId = this.generateNewMutationId();

    return this.mutate(mutationFunctionOptions)
      .then((response: FetchResult<TData>) => {
        this.onMutationCompleted(response, mutationId);
        return response;
      })
      .catch((error: ApolloError) => {
        const { onError } = this.getOptions();
        this.onMutationError(error, mutationId);
        if (onError) {
          onError(error);
          return {
            data: undefined,
            errors: error,
          };
        } else {
          throw error;
        }
      });
  };

  private mutate(
    options: MutationFunctionOptions<TData, TVariables, TContext, TCache>
  ) {
    return this.refreshClient().client.mutate(
      mergeOptions(
        this.getOptions(),
        options as MutationOptions<TData, TVariables, TContext>,
      ),
    );
  }

  private onMutationStart() {
    if (!this.result.loading && !this.getOptions().ignoreResults) {
      this.updateResult({
        loading: true,
        error: undefined,
        data: undefined,
        called: true
      });
    }
  }

  private onMutationCompleted(
    response: FetchResult<TData>,
    mutationId: number
  ) {
    const { onCompleted, ignoreResults } = this.getOptions();

    const { data, errors } = response;
    const error =
      errors && errors.length > 0
        ? new ApolloError({ graphQLErrors: errors })
        : undefined;

    const callOncomplete = () =>
      onCompleted ? onCompleted(data as TData) : null;

    if (this.isMostRecentMutation(mutationId) && !ignoreResults) {
      this.updateResult({
        called: true,
        loading: false,
        data,
        error
      });
    }
    callOncomplete();
  }

  private onMutationError(error: ApolloError, mutationId: number) {
    if (this.isMostRecentMutation(mutationId)) {
      this.updateResult({
        loading: false,
        error,
        data: undefined,
        called: true
      });
    }
  }

  private generateNewMutationId(): number {
    return ++this.mostRecentMutationId;
  }

  private isMostRecentMutation(mutationId: number) {
    return this.mostRecentMutationId === mutationId;
  }

  private updateResult(result: MutationResultWithoutClient<TData>): MutationResultWithoutClient<TData> | undefined {
    if (
      this.isMounted &&
      (!this.previousResult || !equal(this.previousResult, result))
    ) {
      this.setResult(result);
      this.previousResult = result;
      return result;
    }
  }
}
