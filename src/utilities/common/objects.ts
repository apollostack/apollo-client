export function isNonNullObject(obj: any): obj is Record<string | number, any> {
  return obj !== null && typeof obj === 'object';
}
