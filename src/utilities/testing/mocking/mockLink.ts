import { print } from 'graphql/language/printer';
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
} from '../../../utilities';

export type ResultFunction<T, V = Record<string, any>> = (variables: V) => T;

export type VariableMatcher<V> = (variables: V) => boolean;

export interface MockedResponse<TData = Record<string, any>, TVariables = Record<string, any>> {
  request: GraphQLRequest;
  result?: FetchResult<TData> | ResultFunction<FetchResult<TData>, TVariables>;
  error?: Error;
  delay?: number;
  variableMatcher?: VariableMatcher<TVariables>,
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
    let responseIndex: number = 0;
    const response = (this.mockedResponsesByKey[key] || []).find(
      (res, index) => {
        if (res.variableMatcher && res.variableMatcher(operation.variables)) {
          responseIndex = index;
          return true;
        }
        return false;
      }
    );

    if (!response || typeof responseIndex === 'undefined') {
      this.onError(new Error(
        `No more mocked responses for the query: ${print(
          operation.query
        )}, variables: ${JSON.stringify(operation.variables)}`
      ));
      return null;
    }

    this.mockedResponsesByKey[key].splice(responseIndex, 1);

    const { newData } = response!;

    if (newData) {
      response!.result = newData(operation.variables);
      this.mockedResponsesByKey[key].push(response!);
    }

    const { result, error, delay } = response!;

    if (!result && !error) {
      this.onError(new Error(
        `Mocked response should contain either result or error: ${key}`
      ));
    }

    return new Observable(observer => {
      let timer = setTimeout(
        () => {
          if (error) {
            observer.error(error);
          } else {
            if (result) {
              observer.next(
                typeof result === 'function'
                  ? (result as ResultFunction<FetchResult>)(operation.variables)
                  : result
              );
            }
            observer.complete();
          }
        },
        delay ? delay : 0
      );

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
    this.normalizeVariableMatching(newMockedResponse);
    return newMockedResponse;
  }

  private normalizeVariableMatching(mockedResponse: MockedResponse) {
    const variables = mockedResponse.request.variables;
    if (mockedResponse.variableMatcher && variables) {
      throw new Error('Mocked response should contain either variableMatcher or request.variables');
    }

    if (!mockedResponse.variableMatcher) {
      mockedResponse.variableMatcher = (vars) => {
        const requestVariables = vars || {};
        const mockedResponseVariables = variables || {};
        return equal(requestVariables, mockedResponseVariables);
      };
    }
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
