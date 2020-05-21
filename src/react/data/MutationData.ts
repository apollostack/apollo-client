import { equal } from '@wry/equality';

import { DocumentType } from '../parser/parser';
import { ApolloError } from '../../errors/ApolloError';
import type {
  MutationDataOptions,
  MutationTuple,
  MutationFunctionOptions,
  MutationResult
} from '../types/types';
import { OperationData } from './OperationData';
import type { OperationVariables } from '../../core/types';
import type { FetchResult } from '../../link/core/types';

export class MutationData<
  TData = any,
  TVariables = OperationVariables
> extends OperationData {
  private mostRecentMutationId: number;
  private result: MutationResult<TData>;
  private previousResult?: MutationResult<TData>;
  private setResult: (result: MutationResult<TData>) => any;

  constructor({
    options,
    context,
    result,
    setResult
  }: {
    options: MutationDataOptions<TData, TVariables>;
    context: any;
    result: MutationResult<TData>;
    setResult: (result: MutationResult<TData>) => any;
  }) {
    super(options, context);
    this.verifyDocumentType(options.mutation, DocumentType.Mutation);
    this.result = result;
    this.setResult = setResult;
    this.mostRecentMutationId = 0;
  }

  public execute(result: MutationResult<TData>) {
    this.isMounted = true;
    this.verifyDocumentType(this.getOptions().mutation, DocumentType.Mutation);
    return [
      this.runMutation,
      { ...result, client: this.refreshClient().client }
    ] as MutationTuple<TData, TVariables>;
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
      TVariables
    > = {} as MutationFunctionOptions<TData, TVariables>
  ) => {
    this.onMutationStart();
    const mutationId = this.generateNewMutationId();

    return this.mutate(mutationFunctionOptions)
      .then((response: FetchResult<TData>) => {
        this.onMutationCompleted(response, mutationId);
        return response;
      })
      .catch((error: ApolloError) => {
        this.onMutationError(error, mutationId);
        if (!this.getOptions().onError) throw error;
      });
  };

  private mutate(
    mutationFunctionOptions: MutationFunctionOptions<TData, TVariables>
  ) {
    const {
      mutation,
      variables,
      optimisticResponse,
      update,
      context: mutationContext = {},
      awaitRefetchQueries = false,
      fetchPolicy,
      errorPolicy,
    } = this.getOptions();
    const mutateOptions = { ...mutationFunctionOptions };

    const mutateVariables = Object.assign(
      {},
      variables,
      mutateOptions.variables
    );
    delete mutateOptions.variables;

    return this.refreshClient().client.mutate({
      mutation,
      optimisticResponse,
      refetchQueries:
        mutateOptions.refetchQueries || this.getOptions().refetchQueries,
      awaitRefetchQueries,
      update,
      context: mutationContext,
      fetchPolicy,
      errorPolicy,
      variables: mutateVariables,
      ...mutateOptions
    });
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
    const { onError } = this.getOptions();

    if (this.isMostRecentMutation(mutationId)) {
      this.updateResult({
        loading: false,
        error,
        data: undefined,
        called: true
      });
    }

    if (onError) {
      onError(error);
    }
  }

  private generateNewMutationId(): number {
    return ++this.mostRecentMutationId;
  }

  private isMostRecentMutation(mutationId: number) {
    return this.mostRecentMutationId === mutationId;
  }

  private updateResult(result: MutationResult<TData>) {
    if (
      this.isMounted &&
      (!this.previousResult || !equal(this.previousResult, result))
    ) {
      this.setResult(result);
      this.previousResult = result;
    }
  }
}
