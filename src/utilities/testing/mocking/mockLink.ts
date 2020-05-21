import { print } from 'graphql/language/printer';
import { equal } from '@wry/equality';

import { Observable } from '../../../utilities/observables/Observable';
import { ApolloLink } from '../../../link/core/ApolloLink';
import type {
  Operation,
  GraphQLRequest,
  FetchResult,
} from '../../../link/core/types';
import {
  addTypenameToDocument,
  removeClientSetsFromDocument,
  removeConnectionDirectiveFromDocument,
} from '../../../utilities/graphql/transform';
import { cloneDeep } from '../../../utilities/common/cloneDeep';
import invariant from 'ts-invariant';

export type ResultFunction<T> = () => T;

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
    let responseIndex: number = 0;
    const response = (this.mockedResponsesByKey[key] || []).find(
      (res, index) => {
        const requestVariables = operation.variables || {};
        const mockedResponseVariables = res.request.variables || {};
        if (equal(requestVariables, mockedResponseVariables)) {
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
      response!.result = newData();
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
                  ? (result as ResultFunction<FetchResult>)()
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
