function wrap<TResult>(key?: "only" | "skip" | "todo") {
  return (
    message: string,
    callback: (
      resolve: (result?: any) => void,
      reject: (reason?: any) => void,
    ) => any,
    timeout?: number,
  ) => (key ? it[key] : it)(message, function () {
    return new Promise(
      (resolve, reject) => callback.call(this, resolve, reject),
    );
  }, timeout);
}

const wrappedIt = wrap();

export const itAsync = Object.assign(function (
  ...args: Parameters<typeof wrappedIt>
) {
  return wrappedIt.apply(this, args);
}, {
  only: wrap("only"),
  skip: wrap("skip"),
  todo: wrap("todo"),
});
