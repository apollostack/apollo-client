import { print } from 'graphql';
import { equal } from '@wry/equality';
import { invariant } from 'ts-invariant';

import {
  ApolloLink,
  Operation,
  GraphQLRequest,
  FetchResult,
} from '../../../link/core';

import {
  Observable,
  addTypenameToDocument,
  removeClientSetsFromDocument,
  removeConnectionDirectiveFromDocument,
  cloneDeep,
  makeUniqueId,
} from '../../../utilities';

export type ResultFunction<T> = () => T;

function stringifyForDisplay(value: any): string {
  const undefId = makeUniqueId("stringifyForDisplay");
  return JSON.stringify(value, (key, value) => {
    return value === void 0 ? undefId : value;
  }).split(JSON.stringify(undefId)).join("<undefined>");
}

export interface MockedResponse<TData = Record<string, any>> {
  request: GraphQLRequest;
  result?: FetchResult<TData> | ResultFunction<FetchResult<TData>>;
  error?: Error;
  delay?: number;
  newData?: ResultFunction<FetchResult>;
}

function requestToKey(request: GraphQLRequest, addTypename: Boolean): string {
  const queryString =
    request.query &&
    print(addTypename ? addTypenameToDocument(request.query) : request.query);
  const requestKey = { query: queryString };
  return JSON.stringify(requestKey);
}

export class MockLink extends ApolloLink {
  public operation: Operation;
  public addTypename: Boolean = true;
  private mockedResponsesByKey: { [key: string]: MockedResponse[] } = {};

  constructor(
    mockedResponses: ReadonlyArray<MockedResponse>,
    addTypename: Boolean = true
  ) {
    super();
    this.addTypename = addTypename;
    if (mockedResponses) {
      mockedResponses.forEach(mockedResponse => {
        this.addMockedResponse(mockedResponse);
      });
    }
  }

  public addMockedResponse(mockedResponse: MockedResponse) {
    const normalizedMockedResponse = this.normalizeMockedResponse(
      mockedResponse
    );
    const key = requestToKey(
      normalizedMockedResponse.request,
      this.addTypename
    );
    let mockedResponses = this.mockedResponsesByKey[key];
    if (!mockedResponses) {
      mockedResponses = [];
      this.mockedResponsesByKey[key] = mockedResponses;
    }
    mockedResponses.push(normalizedMockedResponse);
  }

  public request(operation: Operation): Observable<FetchResult> | null {
    this.operation = operation;
    const key = requestToKey(operation, this.addTypename);
    const unmatchedVars: Array<Record<string, any>> = [];
    const requestVariables = operation.variables || {};
    const mockedResponses = this.mockedResponsesByKey[key];
    const responseIndex = mockedResponses ? mockedResponses.findIndex((res, index) => {
      const mockedResponseVars = res.request.variables || {};
      if (equal(requestVariables, mockedResponseVars)) {
        return true;
      }
      unmatchedVars.push(mockedResponseVars);
      return false;
    }) : -1;

    const response = responseIndex >= 0
      ? mockedResponses[responseIndex]
      : void 0;

    let configError: Error;

    if (!response) {
      configError = new Error(
`No more mocked responses for the query: ${print(operation.query)}
Expected variables: ${stringifyForDisplay(operation.variables)}
${unmatchedVars.length > 0 ? `
Failed to match ${unmatchedVars.length} mock${
  unmatchedVars.length === 1 ? "" : "s"
} for this query, which had the following variables:
${unmatchedVars.map(d => `  ${stringifyForDisplay(d)}`).join('\n')}
` : ""}`);
    } else {
      mockedResponses.splice(responseIndex, 1);

      const { newData } = response;
      if (newData) {
        response.result = newData();
        mockedResponses.push(response);
      }

      if (!response.result && !response.error) {
        configError = new Error(
          `Mocked response should contain either result or error: ${key}`
        );
      }
    }

    return new Observable(observer => {
      const timer = setTimeout(() => {
        if (configError) {
          try {
            // The onError function can return false to indicate that
            // configError need not be passed to observer.error. For
            // example, the default implementation of onError calls
            // observer.error(configError) and then returns false to
            // prevent this extra (harmless) observer.error call.
            if (this.onError(configError, observer) !== false) {
              throw configError;
            }
          } catch (error) {
            observer.error(error);
          }
        } else if (response) {
          if (response.error) {
            observer.error(response.error);
          } else {
            if (response.result) {
              observer.next(
                typeof response.result === 'function'
                  ? (response.result as ResultFunction<FetchResult>)()
                  : response.result
              );
            }
            observer.complete();
          }
        }
      }, response && response.delay || 0);

      return () => {
        clearTimeout(timer);
      };
    });
  }

  private normalizeMockedResponse(
    mockedResponse: MockedResponse
  ): MockedResponse {
    const newMockedResponse = cloneDeep(mockedResponse);
    const queryWithoutConnection = removeConnectionDirectiveFromDocument(
      newMockedResponse.request.query
    );
    invariant(queryWithoutConnection, "query is required");
    newMockedResponse.request.query = queryWithoutConnection!;
    const query = removeClientSetsFromDocument(newMockedResponse.request.query);
    if (query) {
      newMockedResponse.request.query = query;
    }
    return newMockedResponse;
  }
}

export interface MockApolloLink extends ApolloLink {
  operation?: Operation;
}

// Pass in multiple mocked responses, so that you can test flows that end up
// making multiple queries to the server.
// NOTE: The last arg can optionally be an `addTypename` arg.
export function mockSingleLink(
  ...mockedResponses: Array<any>
): MockApolloLink {
  // To pull off the potential typename. If this isn't a boolean, we'll just
  // set it true later.
  let maybeTypename = mockedResponses[mockedResponses.length - 1];
  let mocks = mockedResponses.slice(0, mockedResponses.length - 1);

  if (typeof maybeTypename !== 'boolean') {
    mocks = mockedResponses;
    maybeTypename = true;
  }

  return new MockLink(mocks, maybeTypename);
}
