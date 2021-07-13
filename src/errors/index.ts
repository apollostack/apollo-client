import { invariant } from "ts-invariant";
import { DEV } from "../utilities";
invariant("boolean" === typeof DEV, DEV);

import { GraphQLError } from 'graphql';

import { isNonEmptyArray } from '../utilities';
import { ServerParseError } from '../link/http';
import { ServerError } from '../link/utils';

export function isApolloError(err: Error): err is ApolloError {
  return err.hasOwnProperty('graphQLErrors');
}

// Sets the error message on this error according to the
// the GraphQL and network errors that are present.
// If the error message has already been set through the
// constructor or otherwise, this function is a nop.
const generateErrorMessage = (err: ApolloError) => {
  let message = '';
  // If we have GraphQL errors present, add that to the error message.
  if (isNonEmptyArray(err.graphQLErrors) || isNonEmptyArray(err.clientErrors)) {
    const errors = ((err.graphQLErrors || []) as readonly Error[])
      .concat(err.clientErrors || []);
    errors.forEach((error: Error) => {
      const errorMessage = error
        ? error.message
        : 'Error message not found.';
      message += `${errorMessage}\n`;
    });
  }

  if (err.networkError) {
    message += `${err.networkError.message}\n`;
  }

  // strip newline from the end of the message
  message = message.replace(/\n$/, '');
  return message;
};

export class ApolloError extends Error {
  public message: string;
  public graphQLErrors: ReadonlyArray<GraphQLError>;
  public clientErrors: ReadonlyArray<Error>;
  public networkError: Error | ServerParseError | ServerError | null;

  // An object that can be used to provide some additional information
  // about an error, e.g. specifying the type of error this is. Used
  // internally within Apollo Client.
  public extraInfo: any;

  // Constructs an instance of ApolloError given a GraphQLError
  // or a network error. Note that one of these has to be a valid
  // value or the constructed error will be meaningless.
  constructor({
    graphQLErrors,
    clientErrors,
    networkError,
    errorMessage,
    extraInfo,
  }: {
    graphQLErrors?: ReadonlyArray<GraphQLError>;
    clientErrors?: ReadonlyArray<Error>;
    networkError?: Error | ServerParseError | ServerError | null;
    errorMessage?: string;
    extraInfo?: any;
  }) {
    super(errorMessage);
    this.graphQLErrors = graphQLErrors || [];
    this.clientErrors = clientErrors || [];
    this.networkError = networkError || null;
    this.message = errorMessage || generateErrorMessage(this);
    this.extraInfo = extraInfo;

    // We're not using `Object.setPrototypeOf` here as it isn't fully
    // supported on Android (see issue #3236).
    (this as any).__proto__ = ApolloError.prototype;
  }
}
