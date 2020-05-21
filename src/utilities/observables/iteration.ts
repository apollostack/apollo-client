import type { Observer } from "./Observable";

export function iterateObserversSafely<E, A>(
  observers: Set<Observer<E>>,
  method: keyof Observer<E>,
  argument?: A,
) {
  // In case observers is modified during iteration, we need to commit to the
  // original elements, which also provides an opportunity to filter them down
  // to just the observers with the given method.
  const observersWithMethod: Observer<E>[] = [];
  observers.forEach(obs => obs[method] && observersWithMethod.push(obs));
  observersWithMethod.forEach(obs => (obs as any)[method](argument));
}
