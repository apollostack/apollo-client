export function voidFetchDuringEachTest() {
  let fetchDesc = Object.getOwnPropertyDescriptor(window, "fetch");

  beforeEach(() => {
    fetchDesc = fetchDesc || Object.getOwnPropertyDescriptor(window, "fetch");
    if (fetchDesc?.configurable) {
      delete (window as any).fetch;
    }
  });

  afterEach(() => {
    if (fetchDesc?.configurable) {
      Object.defineProperty(window, "fetch", fetchDesc);
    }
  });
}

describe("voidFetchDuringEachTest", () => {
  voidFetchDuringEachTest();

  it("hides the global.fetch function", () => {
    expect(window.fetch).toBe(void 0);
    expect(() => fetch).toThrowError(ReferenceError);
  });

  it("globalThis === window", () => {
    expect(globalThis).toBe(window);
  });
});
