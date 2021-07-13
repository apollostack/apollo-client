// The ordering of these imports is important, because it ensures the temporary
// process.env.NODE_ENV polyfill is defined globally (if necessary) before we
// import { isType } from 'graphql'. The instanceOf function that we really care
// about (the one that uses process.env.NODE_ENV) is not exported from the
// top-level graphql package, but isType uses instanceOf, and is exported.
import { remove } from 'ts-invariant/process';
import { isType } from 'graphql';

export function removeTemporaryGlobals() {
  // Calling isType here just to make sure it won't be tree-shaken away,
  // provided applyFixes is called elsewhere.
  isType(null);
  return remove();
}
