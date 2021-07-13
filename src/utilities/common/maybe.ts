export function maybe<T>(thunk: () => T): T | undefined {
  try { return thunk() } catch {}
}
