import type { FieldNode } from 'graphql';

import type { NormalizedCache } from './types';
import {
  Reference,
  isReference,
  StoreValue,
  StoreObject,
  isField
} from '../../utilities/graphql/storeUtils';
import { DeepMerger, ReconcilerFunction } from '../../utilities/common/mergeDeep';

export const hasOwn = Object.prototype.hasOwnProperty;

export function getTypenameFromStoreObject(
  store: NormalizedCache,
  objectOrReference: StoreObject | Reference,
): string | undefined {
  return isReference(objectOrReference)
    ? store.get(objectOrReference.__ref, "__typename") as string
    : objectOrReference && objectOrReference.__typename;
}

const FieldNamePattern = /^[_A-Za-z0-9]+/;
export function fieldNameFromStoreName(storeFieldName: string): string {
  const match = storeFieldName.match(FieldNamePattern);
  return match ? match[0] : storeFieldName;
}

// Invoking merge functions needs to happen after processSelectionSet has
// finished, but requires information that is more readily available
// during processSelectionSet, so processSelectionSet embeds special
// objects of the following shape within its result tree, which then must
// be removed by calling Policies#applyMerges.
export interface FieldValueToBeMerged {
  __field: FieldNode;
  __typename: string;
  __value: StoreValue;
}

export function storeValueIsStoreObject(
  value: StoreValue,
): value is StoreObject {
  return value !== null &&
    typeof value === "object" &&
    !isReference(value) &&
    !Array.isArray(value);
}

export function isFieldValueToBeMerged(
  value: any,
): value is FieldValueToBeMerged {
  const field = value && value.__field;
  return field && isField(field);
}

export function makeProcessedFieldsMerger() {
  // A DeepMerger that merges arrays and objects structurally, but otherwise
  // prefers incoming scalar values over existing values. Provides special
  // treatment for FieldValueToBeMerged objects. Used to accumulate fields
  // when processing a single selection set.
  return new DeepMerger(reconcileProcessedFields);
}

const reconcileProcessedFields: ReconcilerFunction<[]> = function (
  existingObject,
  incomingObject,
  property,
) {
  const existing = existingObject[property];
  const incoming = incomingObject[property];

  if (isFieldValueToBeMerged(existing)) {
    existing.__value = this.merge(
      existing.__value,
      isFieldValueToBeMerged(incoming)
        // TODO Check compatibility of __field and __typename properties?
        ? incoming.__value
        : incoming,
    );
    return existing;
  }

  if (isFieldValueToBeMerged(incoming)) {
    incoming.__value = this.merge(
      existing,
      incoming.__value,
    );
    return incoming;
  }

  return this.merge(existing, incoming);
}
