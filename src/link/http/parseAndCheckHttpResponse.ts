import type { Operation } from '../core/types';
import { throwServerError } from '../utils/throwServerError';

const { hasOwnProperty } = Object.prototype;

export type ServerParseError = Error & {
  response: Response;
  statusCode: number;
  bodyText: string;
};

export function parseAndCheckHttpResponse(
  operations: Operation | Operation[],
) {
  return (response: Response) => response
    .text()
    .then(bodyText => {
      try {
        return JSON.parse(bodyText);
      } catch (err) {
        const parseError = err as ServerParseError;
        parseError.name = 'ServerParseError';
        parseError.response = response;
        parseError.statusCode = response.status;
        parseError.bodyText = bodyText;
        throw parseError;
      }
    })
    .then((result: any) => {
      if (response.status >= 300) {
        // Network error
        throwServerError(
          response,
          result,
          `Response not successful: Received status code ${response.status}`,
        );
      }

      if (
        !Array.isArray(result) &&
        !hasOwnProperty.call(result, 'data') &&
        !hasOwnProperty.call(result, 'errors')
      ) {
        // Data error
        throwServerError(
          response,
          result,
          `Server response was missing for query '${
            Array.isArray(operations)
              ? operations.map(op => op.operationName)
              : operations.operationName
          }'.`,
        );
      }
      return result;
    });
}
