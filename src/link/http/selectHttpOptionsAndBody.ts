import { print } from 'graphql';

import { Operation } from '../core';

export interface UriFunction {
  (operation: Operation): string;
}

export interface Body {
  query?: string;
  operationName?: string;
  variables?: Record<string, any>;
  extensions?: Record<string, any>;
}

export interface HttpOptions {
  /**
   * The URI to use when fetching operations.
   *
   * Defaults to '/graphql'.
   */
  uri?: string | UriFunction;

  /**
   * Passes the extensions field to your graphql server.
   *
   * Defaults to false.
   */
  includeExtensions?: boolean;

  /**
   * A `fetch`-compatible API to use when making requests.
   */
  fetch?: WindowOrWorkerGlobalScope['fetch'];

  /**
   * An object representing values to be sent as headers on the request.
   */
  headers?: any;

  /**
   * The credentials policy you want to use for the fetch call.
   */
  credentials?: string;

  /**
   * Any overrides of the fetch options argument to pass to the fetch call.
   */
  fetchOptions?: any;

  /**
   * If set to true, use the HTTP GET method for query operations. Mutations
   * will still use the method specified in fetchOptions.method (which defaults
   * to POST).
   */
  useGETForQueries?: boolean;

  /**
   * If set to true, the default behavior of stripping unused variables
   * from the request will be disabled.
   *
   * Unused variables are likely to trigger server-side validation errors,
   * per https://spec.graphql.org/draft/#sec-All-Variables-Used, but this
   * includeUnusedVariables option can be useful if your server deviates
   * from the GraphQL specification by not strictly enforcing that rule.
   */
  includeUnusedVariables?: boolean;
}

export interface HttpQueryOptions {
  includeQuery?: boolean;
  includeExtensions?: boolean;
}

export interface HttpConfig {
  http?: HttpQueryOptions;
  options?: any;
  headers?: any;
  credentials?: any;
}

const defaultHttpOptions: HttpQueryOptions = {
  includeQuery: true,
  includeExtensions: false,
};

const defaultHeaders = {
  // headers are case insensitive (https://stackoverflow.com/a/5259004)
  accept: '*/*',
  'content-type': 'application/json',
};

const defaultOptions = {
  method: 'POST',
};

export const fallbackHttpConfig = {
  http: defaultHttpOptions,
  headers: defaultHeaders,
  options: defaultOptions,
};

export const selectHttpOptionsAndBody = (
  operation: Operation,
  fallbackConfig: HttpConfig,
  ...configs: Array<HttpConfig>
) => {
  let options: HttpConfig & Record<string, any> = {
    ...fallbackConfig.options,
    headers: fallbackConfig.headers,
    credentials: fallbackConfig.credentials,
  };
  let http: HttpQueryOptions = fallbackConfig.http || {};

  /*
   * use the rest of the configs to populate the options
   * configs later in the list will overwrite earlier fields
   */
  configs.forEach(config => {
    options = {
      ...options,
      ...config.options,
      headers: {
        ...options.headers,
        ...headersToLowerCase(config.headers),
      },
    };
    if (config.credentials) options.credentials = config.credentials;

    http = {
      ...http,
      ...config.http,
    };
  });

  //The body depends on the http options
  const { operationName, extensions, variables, query } = operation;
  const body: Body = { operationName, variables };

  if (http.includeExtensions) (body as any).extensions = extensions;

  // not sending the query (i.e persisted queries)
  if (http.includeQuery) (body as any).query = print(query);

  return {
    options,
    body,
  };
};

function headersToLowerCase(
  headers: Record<string, string> | undefined
): typeof headers {
  if (headers) {
    const normalized = Object.create(null);
    Object.keys(Object(headers)).forEach(name => {
      normalized[name.toLowerCase()] = headers[name];
    });
    return normalized;
  }
  return headers;
}
