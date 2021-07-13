export function withErrorSpy<
  TArgs extends any[],
  TResult,
>(
  it: (...args: TArgs) => TResult,
  ...args: TArgs
) {
  const fn = args[1];
  args[1] = function () {
    const args = arguments;
    const errorSpy = jest.spyOn(console, 'error');
    errorSpy.mockImplementation(() => {});
    return new Promise(resolve => {
      resolve(fn?.apply(this, args));
    }).finally(() => {
      expect(errorSpy).toMatchSnapshot();
      errorSpy.mockReset();
    });
  };
  return it(...args);
}
