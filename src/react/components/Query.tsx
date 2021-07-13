import * as PropTypes from 'prop-types';

import { OperationVariables } from '../../core';
import { QueryComponentOptions } from './types';
import { useQuery } from '../hooks';

export function Query<TData = any, TVariables = OperationVariables>(
  props: QueryComponentOptions<TData, TVariables>
) {
  const { children, query, ...options } = props;
  const result = useQuery(query, options);
  return result ? children(result) : null;
}

export interface Query<TData, TVariables> {
  propTypes: PropTypes.InferProps<QueryComponentOptions<TData, TVariables>>;
}

Query.propTypes = {
  client: PropTypes.object,
  children: PropTypes.func.isRequired,
  fetchPolicy: PropTypes.string,
  notifyOnNetworkStatusChange: PropTypes.bool,
  onCompleted: PropTypes.func,
  onError: PropTypes.func,
  pollInterval: PropTypes.number,
  query: PropTypes.object.isRequired,
  variables: PropTypes.object,
  ssr: PropTypes.bool,
  partialRefetch: PropTypes.bool,
  returnPartialData: PropTypes.bool
} as Query<any, any>["propTypes"];
