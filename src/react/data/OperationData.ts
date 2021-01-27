import { DocumentNode } from 'graphql';
import { equal } from '@wry/equality';
import { invariant } from 'ts-invariant';

import { ApolloClient } from '../../core';
import { DocumentType, parser, operationName } from '../parser';
import { CommonOptions } from '../types/types';

export abstract class OperationData<TOptions = any> {
  public isMounted: boolean = false;
  public previousOptions: CommonOptions<TOptions> = {} as CommonOptions<
    TOptions
  >;
  public context: any = {};
  public client: ApolloClient<object>;

  private options: CommonOptions<TOptions> = {} as CommonOptions<TOptions>;

  constructor(options?: CommonOptions<TOptions>, context?: any) {
    this.options = options || ({} as CommonOptions<TOptions>);
    this.context = context || {};
  }

  public getOptions(): CommonOptions<TOptions> {
    return this.options;
  }

  public setOptions(
    newOptions: CommonOptions<TOptions>,
    storePrevious: boolean = false
  ) {
    if (storePrevious && !equal(this.options, newOptions)) {
      this.previousOptions = this.options;
    }
    this.options = newOptions;
  }

  public abstract execute(...args: any): any;
  public abstract afterExecute(...args: any): void | (() => void);
  public abstract cleanup(): void;

  protected unmount() {
    this.isMounted = false;
  }

  protected refreshClient() {
    const client =
      (this.options && this.options.client) ||
      (this.context && this.context.client);

    invariant(
      !!client,
      'Could not find "client" in the context or passed in as an option. ' +
        'Wrap the root component in an <ApolloProvider>, or pass an ' +
        'ApolloClient instance in via options.'
    );

    let isNew = false;
    if (client !== this.client) {
      isNew = true;
      this.client = client;
      this.cleanup();
    }
    return {
      client: this.client as ApolloClient<object>,
      isNew
    };
  }

  protected verifyDocumentType(document: DocumentNode, type: DocumentType) {
    const operation = parser(document);
    const requiredOperationName = operationName(type);
    const usedOperationName = operationName(operation.type);
    invariant(
      operation.type === type,
      `Running a ${requiredOperationName} requires a graphql ` +
        `${requiredOperationName}, but a ${usedOperationName} was used instead.`
    );
  }
}
