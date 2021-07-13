import global from "../common/global";
import { maybe } from "../common/maybe";

// To keep string-based find/replace minifiers from messing with __DEV__ inside
// string literals or properties like global.__DEV__, we construct the "__DEV__"
// string in a roundabout way that won't be altered by find/replace strategies.
const __ = "__";
const GLOBAL_KEY = [__, __].join("DEV");

function getDEV() {
  try {
    return Boolean(__DEV__);
  } catch {
    Object.defineProperty(global, GLOBAL_KEY, {
      // In a buildless browser environment, maybe(() => process.env.NODE_ENV)
      // evaluates as undefined, so __DEV__ becomes true by default, but can be
      // initialized to false instead by a script/module that runs earlier.
      value: maybe(() => process.env.NODE_ENV) !== "production",
      enumerable: false,
      configurable: true,
      writable: true,
    });
    // Using computed property access rather than global.__DEV__ here prevents
    // string-based find/replace strategies from munging this to global.false:
    return (global as any)[GLOBAL_KEY];
  }
}

export default getDEV();
