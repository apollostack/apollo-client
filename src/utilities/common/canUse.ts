export const canUseWeakMap = typeof WeakMap === 'function' && !(
  typeof navigator === 'object' &&
  navigator.product === 'ReactNative'
);

export const canUseWeakSet = typeof WeakSet === 'function';
