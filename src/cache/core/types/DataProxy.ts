import type { DocumentNode } from 'graphql'; // eslint-disable-line import/no-extraneous-dependencies, import/no-unresolved

import type { MissingFieldError } from './common';

export namespace DataProxy {
  export interface Query<TVariables> {
    /**
     * The GraphQL query shape to be used constructed using the `gql` template
     * string tag from `graphql-tag`. The query will be used to determine the
     * shape of the data to be read.
     */
    query: DocumentNode;

    /**
     * Any variables that the GraphQL query may depend on.
     */
    variables?: TVariables;

    /**
     * The root id to be used. Defaults to "ROOT_QUERY", which is the ID of the
     * root query object. This property makes writeQuery capable of writing data
     * to any object in the cache, which renders writeFragment mostly useless.
     */
    id?: string;
  }

  export interface Fragment<TVariables> {
    /**
     * The root id to be used. This id should take the same form as the
     * value returned by your `dataIdFromObject` function. If a value with your
     * id does not exist in the store, `null` will be returned.
     */
    id: string;

    /**
     * A GraphQL document created using the `gql` template string tag from
     * `graphql-tag` with one or more fragments which will be used to determine
     * the shape of data to read. If you provide more than one fragment in this
     * document then you must also specify `fragmentName` to select a single.
     */
    fragment: DocumentNode;

    /**
     * The name of the fragment in your GraphQL document to be used. If you do
     * not provide a `fragmentName` and there is only one fragment in your
     * `fragment` document then that fragment will be used.
     */
    fragmentName?: string;

    /**
     * Any variables that your GraphQL fragments depend on.
     */
    variables?: TVariables;
  }

  export interface WriteQueryOptions<TData, TVariables>
    extends Query<TVariables> {
    /**
     * The data you will be writing to the store.
     */
    data: TData;
    /**
     * Whether to notify query watchers (default: true).
     */
    broadcast?: boolean;
  }

  export interface WriteFragmentOptions<TData, TVariables>
    extends Fragment<TVariables> {
    /**
     * The data you will be writing to the store.
     */
    data: TData;
    /**
     * Whether to notify query watchers (default: true).
     */
    broadcast?: boolean;
  }

  export type DiffResult<T> = {
    result?: T;
    complete?: boolean;
    missing?: MissingFieldError[];
  }
}

/**
 * A proxy to the normalized data living in our store. This interface allows a
 * user to read and write denormalized data which feels natural to the user
 * whilst in the background this data is being converted into the normalized
 * store format.
 */
export interface DataProxy {
  /**
   * Reads a GraphQL query from the root query id.
   */
  readQuery<QueryType, TVariables = any>(
    options: DataProxy.Query<TVariables>,
    optimistic?: boolean,
  ): QueryType | null;

  /**
   * Reads a GraphQL fragment from any arbitrary id. If there is more than
   * one fragment in the provided document then a `fragmentName` must be
   * provided to select the correct fragment.
   */
  readFragment<FragmentType, TVariables = any>(
    options: DataProxy.Fragment<TVariables>,
    optimistic?: boolean,
  ): FragmentType | null;

  /**
   * Writes a GraphQL query to the root query id.
   */
  writeQuery<TData = any, TVariables = any>(
    options: DataProxy.WriteQueryOptions<TData, TVariables>,
  ): void;

  /**
   * Writes a GraphQL fragment to any arbitrary id. If there is more than
   * one fragment in the provided document then a `fragmentName` must be
   * provided to select the correct fragment.
   */
  writeFragment<TData = any, TVariables = any>(
    options: DataProxy.WriteFragmentOptions<TData, TVariables>,
  ): void;
}
