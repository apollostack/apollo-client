import { serializeFetchParameter } from './serializeFetchParameter';
import type { Body } from './selectHttpOptionsAndBody';

// For GET operations, returns the given URI rewritten with parameters, or a
// parse error.
export function rewriteURIForGET(chosenURI: string, body: Body) {
  // Implement the standard HTTP GET serialization, plus 'extensions'. Note
  // the extra level of JSON serialization!
  const queryParams: string[] = [];
  const addQueryParam = (key: string, value: string) => {
    queryParams.push(`${key}=${encodeURIComponent(value)}`);
  };

  if ('query' in body) {
    addQueryParam('query', body.query!);
  }
  if (body.operationName) {
    addQueryParam('operationName', body.operationName);
  }
  if (body.variables) {
    let serializedVariables;
    try {
      serializedVariables = serializeFetchParameter(
        body.variables,
        'Variables map',
      );
    } catch (parseError) {
      return { parseError };
    }
    addQueryParam('variables', serializedVariables);
  }
  if (body.extensions) {
    let serializedExtensions;
    try {
      serializedExtensions = serializeFetchParameter(
        body.extensions,
        'Extensions map',
      );
    } catch (parseError) {
      return { parseError };
    }
    addQueryParam('extensions', serializedExtensions);
  }

  // Reconstruct the URI with added query params.
  // XXX This assumes that the URI is well-formed and that it doesn't
  //     already contain any of these query params. We could instead use the
  //     URL API and take a polyfill (whatwg-url@6) for older browsers that
  //     don't support URLSearchParams. Note that some browsers (and
  //     versions of whatwg-url) support URL but not URLSearchParams!
  let fragment = '',
    preFragment = chosenURI;
  const fragmentStart = chosenURI.indexOf('#');
  if (fragmentStart !== -1) {
    fragment = chosenURI.substr(fragmentStart);
    preFragment = chosenURI.substr(0, fragmentStart);
  }
  const queryParamsPrefix = preFragment.indexOf('?') === -1 ? '?' : '&';
  const newURI =
    preFragment + queryParamsPrefix + queryParams.join('&') + fragment;
  return { newURI };
}
