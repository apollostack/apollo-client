import { InvariantError, invariant } from 'ts-invariant';

import { Observable } from '../../utilities';
import {
  NextLink,
  Operation,
  RequestHandler,
  FetchResult,
  GraphQLRequest
} from './types';
import {
  validateOperation,
  createOperation,
  transformOperation,
} from '../utils';
import { of } from 'rxjs';

function passthrough(op: Operation, forward: NextLink): Observable<FetchResult> {
  return forward ? forward(op) : of();
}

function toLink(handler: RequestHandler | ApolloLink) {
  return typeof handler === 'function' ? new ApolloLink(handler) : handler;
}

function isTerminating(link: ApolloLink): boolean {
  return link.request.length <= 1;
}

class LinkError extends Error {
  public link?: ApolloLink;
  constructor(message?: string, link?: ApolloLink) {
    super(message);
    this.link = link;
  }
}

export class ApolloLink {
  public static empty(): ApolloLink {
    return new ApolloLink(() => of());
  }

  public static from(links: (ApolloLink | RequestHandler)[]): ApolloLink {
    if (links.length === 0) return ApolloLink.empty();
    return links.map(toLink).reduce((x, y) => x.concat(y)) as ApolloLink;
  }

  public static split(
    test: (op: Operation) => boolean,
    left: ApolloLink | RequestHandler,
    right?: ApolloLink | RequestHandler,
  ): ApolloLink {
    const leftLink = toLink(left);
    const rightLink = toLink(right || new ApolloLink(passthrough));

    if (isTerminating(leftLink) && isTerminating(rightLink)) {
      return new ApolloLink(operation => {
        return test(operation)
          ? leftLink.request(operation) || of()
          : rightLink.request(operation) || of();
      });
    } else {
      return new ApolloLink((operation, forward) => {
        return test(operation)
          ? leftLink.request(operation, forward) || of()
          : rightLink.request(operation, forward) || of();
      });
    }
  }

  public static execute(
    link: ApolloLink,
    operation: GraphQLRequest,
  ): Observable<FetchResult> {
    return (
      link.request(
        createOperation(
          operation.context,
          transformOperation(validateOperation(operation)),
        ),
      ) || of()
    );
  }

  public static concat(
    first: ApolloLink | RequestHandler,
    second: ApolloLink | RequestHandler,
  ) {
    const firstLink = toLink(first);
    if (isTerminating(firstLink)) {
      invariant.warn(
        new LinkError(
          `You are calling concat on a terminating link, which will have no effect`,
          firstLink,
        ),
      );
      return firstLink;
    }
    const nextLink = toLink(second);

    if (isTerminating(nextLink)) {
      return new ApolloLink(
        operation =>
          firstLink.request(
            operation,
            op => nextLink.request(op) || of(),
          ) || of(),
      );
    } else {
      return new ApolloLink((operation, forward) => {
        return (
          firstLink.request(operation, op => {
            return nextLink.request(op, forward) || of();
          }) || of()
        );
      });
    }
  }

  constructor(request?: RequestHandler) {
    if (request) this.request = request;
  }

  public split(
    test: (op: Operation) => boolean,
    left: ApolloLink | RequestHandler,
    right?: ApolloLink | RequestHandler,
  ): ApolloLink {
    return this.concat(
      ApolloLink.split(test, left, right || new ApolloLink(passthrough))
    );
  }

  public concat(next: ApolloLink | RequestHandler): ApolloLink {
    return ApolloLink.concat(this, next);
  }

  public request(
    operation: Operation,
    forward?: NextLink,
  ): Observable<FetchResult> | null {
    throw new InvariantError('request is not implemented');
  }

  protected onError(
    error: any,
    observer?: ZenObservable.Observer<FetchResult>,
  ): false | void {
    if (observer && observer.error) {
      observer.error(error);
      // Returning false indicates that observer.error does not need to be
      // called again, since it was already called (on the previous line).
      // Calling observer.error again would not cause any real problems,
      // since only the first call matters, but custom onError functions
      // might have other reasons for wanting to prevent the default
      // behavior by returning false.
      return false;
    }
    // Throw errors will be passed to observer.error.
    throw error;
  }

  public setOnError(fn: ApolloLink["onError"]): this {
    this.onError = fn;
    return this;
  }
}
