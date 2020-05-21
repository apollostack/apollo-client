import type { GraphQLRequest, Operation } from '../core/types';
import { getOperationName } from '../../utilities/graphql/getFromAST';

export function transformOperation(operation: GraphQLRequest): GraphQLRequest {
  const transformedOperation: GraphQLRequest = {
    variables: operation.variables || {},
    extensions: operation.extensions || {},
    operationName: operation.operationName,
    query: operation.query,
  };

  // Best guess at an operation name
  if (!transformedOperation.operationName) {
    transformedOperation.operationName =
      typeof transformedOperation.query !== 'string'
        ? getOperationName(transformedOperation.query) || undefined
        : '';
  }

  return transformedOperation as Operation;
}
