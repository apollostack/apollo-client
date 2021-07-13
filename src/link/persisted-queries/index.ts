import { print } from 'graphql';
import {
  DocumentNode,
  ExecutionResult,
  GraphQLError,
} from 'graphql';
import { invariant } from 'ts-invariant';

import { ApolloLink, Operation } from '../core';
import { Observable, Observer, compact } from '../../utilities';

export const VERSION = 1;

export interface ErrorResponse {
  graphQLErrors?: readonly GraphQLError[];
  networkError?: Error;
  response?: ExecutionResult;
  operation: Operation;
}

type SHA256Function = (...args: any[]) => string | PromiseLike<string>;
type GenerateHashFunction = (document: DocumentNode) => string | PromiseLike<string>;

namespace PersistedQueryLink {
  interface BaseOptions {
    disable?: (error: ErrorResponse) => boolean;
    useGETForHashedQueries?: boolean;
  };

  interface SHA256Options extends BaseOptions {
    sha256: SHA256Function;
    generateHash?: never;
  };

  interface GenerateHashOptions extends BaseOptions {
    sha256?: never;
    generateHash: GenerateHashFunction;
  };

  export type Options = SHA256Options | GenerateHashOptions;
}

const defaultOptions = {
  disable: ({ graphQLErrors, operation }: ErrorResponse) => {
    // if the server doesn't support persisted queries, don't try anymore
    if (
      graphQLErrors &&
      graphQLErrors.some(
        ({ message }) => message === 'PersistedQueryNotSupported',
      )
    ) {
      return true;
    }

    const { response } = operation.getContext();
    // if the server responds with bad request
    // apollo-server responds with 400 for GET and 500 for POST when no query is found
    if (
      response &&
      response.status &&
      (response.status === 400 || response.status === 500)
    ) {
      return true;
    }

    return false;
  },
  useGETForHashedQueries: false,
};

function operationDefinesMutation(operation: Operation) {
  return operation.query.definitions.some(
    d => d.kind === 'OperationDefinition' && d.operation === 'mutation');
}

const { hasOwnProperty } = Object.prototype;

const hashesByQuery = new WeakMap<
  DocumentNode,
  Record<string, Promise<string>>
>();

let nextHashesChildKey = 0;

export const createPersistedQueryLink = (
  options: PersistedQueryLink.Options,
) => {
  // Ensure a SHA-256 hash function is provided, if a custom hash
  // generation function is not provided. We don't supply a SHA-256 hash
  // function by default, to avoid forcing one as a dependency. Developers
  // should pick the most appropriate SHA-256 function (sync or async) for
  // their needs/environment, or provide a fully custom hash generation
  // function (via the `generateHash` option) if they want to handle
  // hashing with something other than SHA-256.
  invariant(
    options && (
      typeof options.sha256 === 'function' ||
      typeof options.generateHash === 'function'
    ),
    'Missing/invalid "sha256" or "generateHash" function. Please ' +
      'configure one using the "createPersistedQueryLink(options)" options ' +
      'parameter.'
  );

  const {
    sha256,
    // If both a `sha256` and `generateHash` option are provided, the
    // `sha256` option will be ignored. Developers can configure and
    // use any hashing approach they want in a custom `generateHash`
    // function; they aren't limited to SHA-256.
    generateHash = (query: DocumentNode) =>
      Promise.resolve<string>(sha256!(print(query))),
    disable,
    useGETForHashedQueries
  } = compact(defaultOptions, options);

  let supportsPersistedQueries = true;

  const hashesChildKey = 'forLink' + nextHashesChildKey++;

  const getHashPromise = (query: DocumentNode) =>
    new Promise<string>(resolve => resolve(generateHash(query)));

  function getQueryHash(query: DocumentNode): Promise<string> {
    if (!query || typeof query !== 'object') {
      // If the query is not an object, we won't be able to store its hash as
      // a property of query[hashesKey], so we let generateHash(query) decide
      // what to do with the bogus query.
      return getHashPromise(query);
    }
    let hashes = hashesByQuery.get(query)!;
    if (!hashes) hashesByQuery.set(query, hashes = Object.create(null));
    return hasOwnProperty.call(hashes, hashesChildKey)
      ? hashes[hashesChildKey]
      : hashes[hashesChildKey] = getHashPromise(query);
  }

  return new ApolloLink((operation, forward) => {
    invariant(
      forward,
      'PersistedQueryLink cannot be the last link in the chain.'
    );

    const { query } = operation;

    return new Observable((observer: Observer<ExecutionResult>) => {
      let subscription: ZenObservable.Subscription;
      let retried = false;
      let originalFetchOptions: any;
      let setFetchOptions = false;
      const retry = (
        {
          response,
          networkError,
        }: { response?: ExecutionResult; networkError?: Error },
        cb: () => void,
      ) => {
        if (!retried && ((response && response.errors) || networkError)) {
          retried = true;

          const disablePayload = {
            response,
            networkError,
            operation,
            graphQLErrors: response ? response.errors : undefined,
          };

          // if the server doesn't support persisted queries, don't try anymore
          supportsPersistedQueries = !disable(disablePayload);

          // if its not found, we can try it again, otherwise just report the error
          if (
            (response &&
              response.errors &&
              response.errors.some(
                ({ message }: { message: string }) =>
                  message === 'PersistedQueryNotFound',
              )) ||
            !supportsPersistedQueries
          ) {
            // need to recall the link chain
            if (subscription) subscription.unsubscribe();
            // actually send the query this time
            operation.setContext({
              http: {
                includeQuery: true,
                includeExtensions: supportsPersistedQueries,
              },
              fetchOptions: {
                // Since we're including the full query, which may be
                // large, we should send it in the body of a POST request.
                // See issue #7456.
                method: 'POST',
              },
            });
            if (setFetchOptions) {
              operation.setContext({ fetchOptions: originalFetchOptions });
            }
            subscription = forward(operation).subscribe(handler);

            return;
          }
        }
        cb();
      };
      const handler = {
        next: (response: ExecutionResult) => {
          retry({ response }, () => observer.next!(response));
        },
        error: (networkError: Error) => {
          retry({ networkError }, () => observer.error!(networkError));
        },
        complete: observer.complete!.bind(observer),
      };

      // don't send the query the first time
      operation.setContext({
        http: {
          includeQuery: !supportsPersistedQueries,
          includeExtensions: supportsPersistedQueries,
        },
      });

      // If requested, set method to GET if there are no mutations. Remember the
      // original fetchOptions so we can restore them if we fall back to a
      // non-hashed request.
      if (
        useGETForHashedQueries &&
        supportsPersistedQueries &&
        !operationDefinesMutation(operation)
      ) {
        operation.setContext(
          ({ fetchOptions = {} }: { fetchOptions: Record<string, any> }) => {
            originalFetchOptions = fetchOptions;
            return {
              fetchOptions: {
                ...fetchOptions,
                method: 'GET',
              },
            };
          },
        );
        setFetchOptions = true;
      }

      if (supportsPersistedQueries) {
        getQueryHash(query).then((sha256Hash) => {
          operation.extensions.persistedQuery = {
            version: VERSION,
            sha256Hash,
          };
          subscription = forward(operation).subscribe(handler);
        }).catch(observer.error!.bind(observer));;
      } else {
        subscription = forward(operation).subscribe(handler);
      }

      return () => {
        if (subscription) subscription.unsubscribe();
      };
    });
  });
};
