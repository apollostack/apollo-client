import { serializeFetchParameter } from './serializeFetchParameter';
import { Body } from './selectHttpOptionsAndBody';

// For GET operations, returns the given URI rewritten with parameters, or a
// parse error. Requires polyfills for URL and URLSearchParams in browsers
// that don't have native support (ex: IE11)
export function rewriteURIForGET(chosenURI: string, body: Body) {
  // Implement the standard HTTP GET serialization, plus 'extensions'. Note
  // the extra level of JSON serialization!
  const url = new URL(chosenURI, 'https://www.ignored-base');

  if ('query' in body) {
    url.searchParams.set('query', body.query!);
  }
  if (body.operationName) {
    url.searchParams.set('operationName', body.operationName);
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
    url.searchParams.set('variables', serializedVariables);
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
    url.searchParams.set('extensions', serializedExtensions);
  }

  return { newURI: `${url.pathname}?${url.searchParams}` };
}
