import { equal } from '@wry/equality';

import { OperationData } from './OperationData';
import {
  SubscriptionCurrentObservable,
  SubscriptionDataOptions,
  SubscriptionResult
} from '../types/types';
import { ApolloError, isApolloError } from '../../core';

export class SubscriptionData<
  TData = any,
  TVariables = any
> extends OperationData<SubscriptionDataOptions<TData, TVariables>> {
  private setResult: any;
  private currentObservable: SubscriptionCurrentObservable = {};

  constructor({
    options,
    context,
    setResult
  }: {
    options: SubscriptionDataOptions<TData, TVariables>;
    context: any;
    setResult: any;
  }) {
    super(options, context);
    this.setResult = setResult;
    this.initialize(options);
  }

  public execute(result: SubscriptionResult<TData>) {
    if (this.getOptions().skip === true) {
      this.cleanup();
      return {
        loading: false,
        error: undefined,
        data: undefined,
        variables: this.getOptions().variables
      };
    }

    let currentResult = result;
    if (this.refreshClient().isNew) {
      currentResult = this.getLoadingResult();
    }

    let { shouldResubscribe } = this.getOptions();
    if (typeof shouldResubscribe === 'function') {
      shouldResubscribe = !!shouldResubscribe(this.getOptions());
    }

    if (
      shouldResubscribe !== false &&
      this.previousOptions &&
      Object.keys(this.previousOptions).length > 0 &&
      (this.previousOptions.subscription !== this.getOptions().subscription ||
        !equal(this.previousOptions.variables, this.getOptions().variables) ||
        this.previousOptions.skip !== this.getOptions().skip)
    ) {
      this.cleanup();
      currentResult = this.getLoadingResult();
    }

    this.initialize(this.getOptions());
    this.startSubscription();

    this.previousOptions = this.getOptions();
    return { ...currentResult, variables: this.getOptions().variables };
  }

  public afterExecute() {
    this.isMounted = true;
  }

  public cleanup() {
    this.endSubscription();
    delete this.currentObservable.query;
  }

  private initialize(options: SubscriptionDataOptions<TData, TVariables>) {
    if (this.currentObservable.query || this.getOptions().skip === true) return;
    this.currentObservable.query = this.refreshClient().client.subscribe({
      query: options.subscription,
      variables: options.variables,
      fetchPolicy: options.fetchPolicy
    });
  }

  private startSubscription() {
    if (this.currentObservable.subscription) return;
    this.currentObservable.subscription = this.currentObservable.query!.subscribe(
      {
        next: this.updateCurrentData.bind(this),
        error: this.updateError.bind(this),
        complete: this.completeSubscription.bind(this)
      }
    );
  }

  private getLoadingResult() {
    return {
      loading: true,
      error: undefined,
      data: undefined
    } as SubscriptionResult<TData>;
  }

  private updateResult(result: SubscriptionResult) {
    if (this.isMounted) {
      this.setResult(result);
    }
  }

  private updateCurrentData(result: SubscriptionResult<TData>) {
    const { onSubscriptionData } = this.getOptions();

    this.updateResult({
      data: result.data,
      loading: false,
      error: undefined
    });

    if (onSubscriptionData) {
      onSubscriptionData({
        client: this.refreshClient().client,
        subscriptionData: result
      });
    }
  }

  private updateError(graphQLError: any) {
    const apolloError = isApolloError(graphQLError)
      ? graphQLError
      : new ApolloError({ graphQLErrors: [graphQLError] });

    this.updateResult({
      error: apolloError,
      loading: false,
    });
  }

  private completeSubscription() {
    const { onSubscriptionComplete } = this.getOptions();
    if (onSubscriptionComplete) onSubscriptionComplete();
    this.endSubscription();
  }

  private endSubscription() {
    if (this.currentObservable.subscription) {
      this.currentObservable.subscription.unsubscribe();
      delete this.currentObservable.subscription;
    }
  }
}
