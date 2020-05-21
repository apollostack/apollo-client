import { ApolloLink } from '../core/ApolloLink';
import type { RequestHandler } from '../core/types';
import type { HttpOptions } from './selectHttpOptionsAndBody';
import { createHttpLink } from './createHttpLink';

export class HttpLink extends ApolloLink {
  public requester: RequestHandler;
  constructor(public options: HttpOptions = {}) {
    super(createHttpLink(options).request);
  }
}
