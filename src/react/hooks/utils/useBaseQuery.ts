import { useContext, useEffect, useReducer, useRef } from 'react';
import { DocumentNode } from 'graphql';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';

import {
  QueryHookOptions,
  QueryDataOptions,
  QueryTuple,
  QueryResult,
} from '../../types/types';
import { QueryData } from '../../data';
import { useDeepMemo } from './useDeepMemo';
import { OperationVariables } from '../../../core';
import { getApolloContext } from '../../context';

export function useBaseQuery<TData = any, TVariables = OperationVariables>(
  query: DocumentNode | TypedDocumentNode<TData, TVariables>,
  options?: QueryHookOptions<TData, TVariables>,
  lazy = false
) {
  const context = useContext(getApolloContext());
  const [tick, forceUpdate] = useReducer(x => x + 1, 0);
  const updatedOptions = options ? { ...options, query } : { query };

  const queryDataRef = useRef<QueryData<TData, TVariables>>();
  const queryData = queryDataRef.current || (
    queryDataRef.current = new QueryData<TData, TVariables>({
      options: updatedOptions as QueryDataOptions<TData, TVariables>,
      context,
      onNewData() {
        if (!queryData.ssrInitiated()) {
          // When new data is received from the `QueryData` object, we want to
          // force a re-render to make sure the new data is displayed. We can't
          // force that re-render if we're already rendering however so to be
          // safe we'll trigger the re-render in a microtask. In case the
          // component gets unmounted before this callback fires, we re-check
          // queryDataRef.current before calling forceUpdate().
          Promise.resolve().then(() => queryDataRef.current && forceUpdate());
        } else {
          // If we're rendering on the server side we can force an update at
          // any point.
          forceUpdate();
        }
      }
    })
  );

  queryData.setOptions(updatedOptions);
  queryData.context = context;

  // `onError` and `onCompleted` callback functions will not always have a
  // stable identity, so we'll exclude them from the memoization key to
  // prevent `afterExecute` from being triggered un-necessarily.
  const memo = {
    options: {
      ...updatedOptions,
      onError: undefined,
      onCompleted: undefined
    } as QueryHookOptions<TData, TVariables>,
    context,
    tick
  };

  const result = useDeepMemo(
    () => (lazy ? queryData.executeLazy() : queryData.execute()),
    memo
  );

  const queryResult = lazy
    ? (result as QueryTuple<TData, TVariables>)[1]
    : (result as QueryResult<TData, TVariables>);

  let _maybeFastRefresh: React.MutableRefObject<boolean>;

  // @ts-expect-error: __DEV__ is a global exposed by react
  if (__DEV__) {
    /* eslint-disable react-hooks/rules-of-hooks */
    _maybeFastRefresh = useRef(false);
    useEffect(() => {
      return () => {
        // Detect fast refresh, only runs multiple times in fast refresh
        _maybeFastRefresh.current = true;
      };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    /* eslint-enable react-hooks/rules-of-hooks */
  }

  useEffect(() => {
    if (_maybeFastRefresh?.current) {
      /**
       * This block only runs during fast refresh, the current resource and
       * its cache is disposed in the previous cleanup.
       * Force a re-render to restart the hook.
       */
      _maybeFastRefresh.current = false;
      forceUpdate();
      return;
    }

    return () => {
      queryData.cleanup();
      // this effect can run multiple times during a fast-refresh
      // so make sure we clean up the ref
      queryDataRef.current = undefined;
    }
  }, []);

  useEffect(() => queryData.afterExecute({ lazy }), [
    queryResult.loading,
    queryResult.networkStatus,
    queryResult.error,
    queryResult.data,
  ]);

  return result;
}
