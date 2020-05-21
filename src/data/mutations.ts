import type { DocumentNode } from 'graphql';

export class MutationStore {
  private store: { [mutationId: string]: MutationStoreValue } = {};

  public getStore(): { [mutationId: string]: MutationStoreValue } {
    return this.store;
  }

  public get(mutationId: string): MutationStoreValue {
    return this.store[mutationId];
  }

  public initMutation(
    mutationId: string,
    mutation: DocumentNode,
    variables: Object | undefined,
  ) {
    this.store[mutationId] = {
      mutation,
      variables: variables || {},
      loading: true,
      error: null,
    };
  }

  public markMutationError(mutationId: string, error: Error) {
    const mutation = this.store[mutationId];
    if (mutation) {
      mutation.loading = false;
      mutation.error = error;
    }
  }

  public markMutationResult(mutationId: string) {
    const mutation = this.store[mutationId];
    if (mutation) {
      mutation.loading = false;
      mutation.error = null;
    }
  }

  public reset() {
    this.store = {};
  }
}

export interface MutationStoreValue {
  mutation: DocumentNode;
  variables: Object;
  loading: boolean;
  error: Error | null;
}
