import { maybe } from "./maybe";

declare global {
  const __DEV__: boolean | undefined;
}

export default (
  maybe(() => globalThis) ||
  maybe(() => window) ||
  maybe(() => self) ||
  maybe(() => global) ||
  maybe(() => Function("return this")())
) as typeof globalThis & {
  __DEV__: typeof __DEV__;
};
