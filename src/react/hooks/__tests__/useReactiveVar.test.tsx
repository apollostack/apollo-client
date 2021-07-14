import React, { StrictMode, useEffect } from "react";
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

  describe("useEffect", () => {
    itAsync("works if updated higher in the component tree", async (resolve, reject) => {
      const counterVar = makeVar(0);

      function ComponentOne() {
        const count = useReactiveVar(counterVar);

        useEffect(() => {
          counterVar(1);
        }, []);

        return (<div>{count}</div>);
      }

      function ComponentTwo() {
        const count = useReactiveVar(counterVar);

        return (<div>{count}</div>);
      }

      const { getAllByText } = render(
        <>
          <ComponentOne />
          <ComponentTwo />
        </>
      );

      await wait(() => {
        expect(getAllByText("1")).toHaveLength(2);
      });

      resolve();
    });

    itAsync("works if updated lower in the component tree", async (resolve, reject) => {
      const counterVar = makeVar(0);

      function ComponentOne() {
        const count = useReactiveVar(counterVar);

        return (<div>{count}</div>);
      }

      function ComponentTwo() {
        const count = useReactiveVar(counterVar);

        useEffect(() => {
          counterVar(1);
        }, []);

        return (<div>{count}</div>);
      }

      const { getAllByText } = render(
        <>
          <ComponentOne />
          <ComponentTwo />
        </>
      );

      await wait(() => {
        expect(getAllByText("1")).toHaveLength(2);
      });

      resolve();
    });

    itAsync("works with strict mode", async (resolve, reject) => {
      const counterVar = makeVar(0);
      const mock = jest.fn();

      function Component() {
        const count = useReactiveVar(counterVar);
        useEffect(() => {
          mock(count);
        }, [count]);

        useEffect(() => {
          Promise.resolve().then(() => {
            counterVar(counterVar() + 1);
          });
        }, []);

        return (
          <div />
        );
      }

      render(
        <StrictMode>
          <Component />
        </StrictMode>
      );

      await wait(() => {
        expect(mock).toHaveBeenCalledWith(1);
      });

      resolve();
    });

    itAsync("works with multiple synchronous calls", async (resolve, reject) => {
      const counterVar = makeVar(0);
      function Component() {
        const count = useReactiveVar(counterVar);

        return (<div>{count}</div>);
      }

      const { getAllByText } = render(<Component />);
      Promise.resolve().then(() => {
        counterVar(1);
        counterVar(2);
        counterVar(3);
        counterVar(4);
        counterVar(5);
        counterVar(6);
        counterVar(7);
        counterVar(8);
        counterVar(9);
        counterVar(10);
      });

      await wait(() => {
        expect(getAllByText("10")).toHaveLength(1);
      });

      resolve();
    });
  });
});
