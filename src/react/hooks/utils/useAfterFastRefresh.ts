import { useEffect, useRef } from "react";

/**
 * This hook allows running a function only immediately after a react
 * fast refresh or live reload.
 *
 * Useful in order to ensure that we can reinitialize things that have been
 * disposed by cleanup functions in `useEffect`.
 * @param effectFn a function to run immediately after a fast refresh
 */
export function useAfterFastRefresh(effectFn: () => unknown) {
  // @ts-expect-error: __DEV__ is a global exposed by react
  if (__DEV__) {
    const didRefresh = useRef(false);
    useEffect(() => {
      return () => {
        // Detect fast refresh, only runs multiple times in fast refresh
        didRefresh.current = true;
      };
    }, []);

    useEffect(() => {
      if (didRefresh?.current === true) {
        // This block only runs after a fast refresh
        didRefresh.current = false;
        effectFn();
      }
    }, [])
  }
}
