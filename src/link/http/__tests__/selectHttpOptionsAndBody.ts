import gql from 'graphql-tag';

import { createOperation } from '../../utils/createOperation';
import {
  selectHttpOptionsAndBody,
  fallbackHttpConfig,
} from '../selectHttpOptionsAndBody';

const query = gql`
  query SampleQuery {
    stub {
      id
    }
  }
`;

describe('selectHttpOptionsAndBody', () => {
  it('includeQuery allows the query to be ignored', () => {
    const { body } = selectHttpOptionsAndBody(
      createOperation({}, { query }),
      { http: { includeQuery: false } },
    );
    expect(body).not.toHaveProperty('query');
  });

  it('includeExtensions allows the extensions to be added', () => {
    const extensions = { yo: 'what up' };
    const { body } = selectHttpOptionsAndBody(
      createOperation({}, { query, extensions }),
      { http: { includeExtensions: true } },
    );
    expect(body).toHaveProperty('extensions');
    expect((body as any).extensions).toEqual(extensions);
  });

  it('the fallbackConfig is used if no other configs are specified', () => {
    const defaultHeaders = {
      accept: '*/*',
      'content-type': 'application/json',
    };

    const defaultOptions = {
      method: 'POST',
    };

    const extensions = { yo: 'what up' };
    const { options, body } = selectHttpOptionsAndBody(
      createOperation({}, { query, extensions }),
      fallbackHttpConfig,
    );

    expect(body).toHaveProperty('query');
    expect(body).not.toHaveProperty('extensions');

    expect(options.headers).toEqual(defaultHeaders);
    expect(options.method).toEqual(defaultOptions.method);
  });

  it('allows headers, credentials, and setting of method to function correctly', () => {
    const headers = {
      accept: 'application/json',
      'content-type': 'application/graphql',
    };

    const credentials = {
      'X-Secret': 'djmashko',
    };

    const opts = {
      opt: 'hi',
    };

    const config = { headers, credentials, options: opts };

    const extensions = { yo: 'what up' };

    const { options, body } = selectHttpOptionsAndBody(
      createOperation({}, { query, extensions }),
      fallbackHttpConfig,
      config,
    );

    expect(body).toHaveProperty('query');
    expect(body).not.toHaveProperty('extensions');

    expect(options.headers).toEqual(headers);
    expect(options.credentials).toEqual(credentials);
    expect(options.opt).toEqual('hi');
    expect(options.method).toEqual('POST'); //from default
  });

  it('normalizes HTTP header names to lower case', () => {
    const headers = {
      accept: 'application/json',
      Accept: 'application/octet-stream',
      'content-type': 'application/graphql',
      'Content-Type': 'application/javascript',
      'CONTENT-type': 'application/json',
    };

    const config = { headers };
    const { options, body } = selectHttpOptionsAndBody(
      createOperation({}, { query }),
      fallbackHttpConfig,
      config,
    );

    expect(body).toHaveProperty('query');
    expect(body).not.toHaveProperty('extensions');

    expect(options.headers).toEqual({
      accept: 'application/octet-stream',
      'content-type': 'application/json',
    });
  });
});
