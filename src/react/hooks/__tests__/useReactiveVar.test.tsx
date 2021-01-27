import React, { useEffect } from "react";
import { render, wait, act } from "@testing-library/react";

import { itAsync } from "../../../testing";
import { makeVar } from "../../../core";
import { useReactiveVar } from "../useReactiveVar";

describe("useReactiveVar Hook", () => {
  itAsync("works with one component", (resolve, reject) => {
    const counterVar = makeVar(0);
    let renderCount = 0;

    function Component() {
      const count = useReactiveVar(counterVar);

      useEffect(() => {
        switch (++renderCount) {
          case 1:
            expect(count).toBe(0);
            counterVar(count + 1);
            break;
          case 2:
            expect(count).toBe(1);
            counterVar(counterVar() + 2);
            break;
          case 3:
            expect(count).toBe(3);
            break;
          default:
            reject(`too many (${renderCount}) renders`);
        }
      });

      return null;
    }

    render(<Component/>);

    return wait(() => {
      expect(renderCount).toBe(3);
      expect(counterVar()).toBe(3);
    }).then(resolve, reject);
  });

  itAsync("works when two components share a variable", async (resolve, reject) => {
    const counterVar = makeVar(0);

    let parentRenderCount = 0;
    function Parent() {
      const count = useReactiveVar(counterVar);

      switch (++parentRenderCount) {
        case 1:
          expect(count).toBe(0);
          break;
        case 2:
          expect(count).toBe(1);
          break;
        case 3:
          expect(count).toBe(11);
          break;
        default:
          reject(`too many (${parentRenderCount}) parent renders`);
      }

      return <Child/>;
    }

    let childRenderCount = 0;
    function Child() {
      const count = useReactiveVar(counterVar);

      switch (++childRenderCount) {
        case 1:
          expect(count).toBe(0);
          break;
        case 2:
          expect(count).toBe(1);
          break;
        case 3:
          expect(count).toBe(11);
          break;
        default:
          reject(`too many (${childRenderCount}) child renders`);
      }

      return null;
    }

    render(<Parent/>);

    await wait(() => {
      expect(parentRenderCount).toBe(1);
      expect(childRenderCount).toBe(1);
    });

    expect(counterVar()).toBe(0);
    act(() => {
      counterVar(1);
    });

    await wait(() => {
      expect(parentRenderCount).toBe(2);
      expect(childRenderCount).toBe(2);
    });

    expect(counterVar()).toBe(1);
    act(() => {
      counterVar(counterVar() + 10);
    });

    await wait(() => {
      expect(parentRenderCount).toBe(3);
      expect(childRenderCount).toBe(3);
    });

    expect(counterVar()).toBe(11);

    resolve();
  });

  itAsync("does not update if component has been unmounted", (resolve, reject) => {
    const counterVar = makeVar(0);
    let renderCount = 0;
    let attemptedUpdateAfterUnmount = false;

    function Component() {
      const count = useReactiveVar(counterVar);

      useEffect(() => {
        if (count < 3) {
          expect(count).toBe(renderCount++);
          counterVar(count + 1);
        }

        if (count === 3) {
          expect(count).toBe(3);
          setTimeout(() => {
            unmount();
            setTimeout(() => {
              counterVar(counterVar() * 2);
              attemptedUpdateAfterUnmount = true;
            }, 10);
          }, 10);
        }
      });

      return null;
    }

    // To detect updates of unmounted components, we have to monkey-patch
    // the console.error method.
    const consoleErrorArgs: any[][] = [];
    const { error } = console;
    console.error = function (...args: any[]) {
      consoleErrorArgs.push(args);
      return error.apply(this, args);
    };

    const { unmount } = render(<Component/>);

    return wait(() => {
      expect(attemptedUpdateAfterUnmount).toBe(true);
    }).then(() => {
      expect(renderCount).toBe(3);
      expect(counterVar()).toBe(6);
      expect(consoleErrorArgs).toEqual([]);
    }).finally(() => {
      console.error = error;
    }).then(resolve, reject);
  });
});
