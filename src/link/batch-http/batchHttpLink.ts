import { ApolloLink, Operation, FetchResult } from '../core';
import { Observable } from '../../utilities';
import { fromError } from '../utils';
import {
  serializeFetchParameter,
  selectURI,
  parseAndCheckHttpResponse,
  checkFetcher,
  selectHttpOptionsAndBody,
  fallbackHttpConfig,
  HttpOptions,
  createSignalIfSupported,
} from '../http';
import { BatchLink } from '../batch';

export namespace BatchHttpLink {
  export type Options = Pick<
    BatchLink.Options,
    'batchMax' | 'batchDebounce' | 'batchInterval' | 'batchKey'
  > & HttpOptions;
}

/**
 * Transforms Operation for into HTTP results.
 * context can include the headers property, which will be passed to the fetch function
 */
export class BatchHttpLink extends ApolloLink {
  private batchDebounce?: boolean;
  private batchInterval: number;
  private batchMax: number;
  private batcher: ApolloLink;

  constructor(fetchParams?: BatchHttpLink.Options) {
    super();

    let {
      uri = '/graphql',
      // use default global fetch if nothing is passed in
      fetch: fetcher,
      includeExtensions,
      batchInterval,
      batchDebounce,
      batchMax,
      batchKey,
      ...requestOptions
    } = fetchParams || ({} as BatchHttpLink.Options);

    // dev warnings to ensure fetch is present
    checkFetcher(fetcher);

    //fetcher is set here rather than the destructuring to ensure fetch is
    //declared before referencing it. Reference in the destructuring would cause
    //a ReferenceError
    if (!fetcher) {
      fetcher = fetch;
    }

    const linkConfig = {
      http: { includeExtensions },
      options: requestOptions.fetchOptions,
      credentials: requestOptions.credentials,
      headers: requestOptions.headers,
    };

    this.batchDebounce = batchDebounce;
    this.batchInterval = batchInterval || 10;
    this.batchMax = batchMax || 10;

    const batchHandler = (operations: Operation[]) => {
      const chosenURI = selectURI(operations[0], uri);

      const context = operations[0].getContext();

      const clientAwarenessHeaders: {
        'apollographql-client-name'?: string;
        'apollographql-client-version'?: string;
      } = {};
      if (context.clientAwareness) {
        const { name, version } = context.clientAwareness;
        if (name) {
          clientAwarenessHeaders['apollographql-client-name'] = name;
        }
        if (version) {
          clientAwarenessHeaders['apollographql-client-version'] = version;
        }
      }

      const contextConfig = {
        http: context.http,
        options: context.fetchOptions,
        credentials: context.credentials,
        headers: { ...clientAwarenessHeaders, ...context.headers },
      };

      //uses fallback, link, and then context to build options
      const optsAndBody = operations.map(operation =>
        selectHttpOptionsAndBody(
          operation,
          fallbackHttpConfig,
          linkConfig,
          contextConfig,
        ),
      );

      const loadedBody = optsAndBody.map(({ body }) => body);
      const options = optsAndBody[0].options;

      // There's no spec for using GET with batches.
      if (options.method === 'GET') {
        return fromError<FetchResult[]>(
          new Error('apollo-link-batch-http does not support GET requests'),
        );
      }

      try {
        (options as any).body = serializeFetchParameter(loadedBody, 'Payload');
      } catch (parseError) {
        return fromError<FetchResult[]>(parseError);
      }

      let controller: any;
      if (!(options as any).signal) {
        const { controller: _controller, signal } = createSignalIfSupported();
        controller = _controller;
        if (controller) (options as any).signal = signal;
      }

      return new Observable<FetchResult[]>(observer => {
        fetcher!(chosenURI, options)
          .then(response => {
            // Make the raw response available in the context.
            operations.forEach(operation => operation.setContext({ response }));
            return response;
          })
          .then(parseAndCheckHttpResponse(operations))
          .then(result => {
            // we have data and can send it to back up the link chain
            observer.next(result);
            observer.complete();
            return result;
          })
          .catch(err => {
            // fetch was cancelled so its already been cleaned up in the unsubscribe
            if (err.name === 'AbortError') return;
            // if it is a network error, BUT there is graphql result info
            // fire the next observer before calling error
            // this gives apollo-client (and react-apollo) the `graphqlErrors` and `networErrors`
            // to pass to UI
            // this should only happen if we *also* have data as part of the response key per
            // the spec
            if (err.result && err.result.errors && err.result.data) {
              // if we dont' call next, the UI can only show networkError because AC didn't
              // get andy graphqlErrors
              // this is graphql execution result info (i.e errors and possibly data)
              // this is because there is no formal spec how errors should translate to
              // http status codes. So an auth error (401) could have both data
              // from a public field, errors from a private field, and a status of 401
              // {
              //  user { // this will have errors
              //    firstName
              //  }
              //  products { // this is public so will have data
              //    cost
              //  }
              // }
              //
              // the result of above *could* look like this:
              // {
              //   data: { products: [{ cost: "$10" }] },
              //   errors: [{
              //      message: 'your session has timed out',
              //      path: []
              //   }]
              // }
              // status code of above would be a 401
              // in the UI you want to show data where you can, errors as data where you can
              // and use correct http status codes
              observer.next(err.result);
            }

            observer.error(err);
          });

        return () => {
          // XXX support canceling this request
          // https://developers.google.com/web/updates/2017/09/abortable-fetch
          if (controller) controller.abort();
        };
      });
    };

    batchKey =
      batchKey ||
      ((operation: Operation) => {
        const context = operation.getContext();

        const contextConfig = {
          http: context.http,
          options: context.fetchOptions,
          credentials: context.credentials,
          headers: context.headers,
        };

        //may throw error if config not serializable
        return selectURI(operation, uri) + JSON.stringify(contextConfig);
      });

    this.batcher = new BatchLink({
      batchDebounce: this.batchDebounce,
      batchInterval: this.batchInterval,
      batchMax: this.batchMax,
      batchKey,
      batchHandler,
    });
  }

  public request(operation: Operation): Observable<FetchResult> | null {
    return this.batcher.request(operation);
  }
}
