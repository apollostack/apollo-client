import {
  DirectiveNode,
  FieldNode,
  IntValueNode,
  FloatValueNode,
  StringValueNode,
  BooleanValueNode,
  ObjectValueNode,
  ListValueNode,
  EnumValueNode,
  NullValueNode,
  VariableNode,
  InlineFragmentNode,
  ValueNode,
  SelectionNode,
  NameNode,
  SelectionSetNode,
  DocumentNode,
} from 'graphql';

import { InvariantError } from 'ts-invariant';
import { isNonNullObject } from '../common/objects';
import { FragmentMap, getFragmentFromSelection } from './fragments';

export interface Reference {
  readonly __ref: string;
}

export function makeReference(id: string): Reference {
  return { __ref: String(id) };
}

export function isReference(obj: any): obj is Reference {
  return Boolean(obj && typeof obj === 'object' && typeof obj.__ref === 'string');
}

export type StoreValue =
  | number
  | string
  | string[]
  | Reference
  | Reference[]
  | null
  | undefined
  | void
  | Object;

export interface StoreObject {
  __typename?: string;
  [storeFieldName: string]: StoreValue;
}

export function isDocumentNode(value: any): value is DocumentNode {
  return (
    isNonNullObject(value) &&
    (value as DocumentNode).kind === "Document" &&
    Array.isArray((value as DocumentNode).definitions)
  );
}

function isStringValue(value: ValueNode): value is StringValueNode {
  return value.kind === 'StringValue';
}

function isBooleanValue(value: ValueNode): value is BooleanValueNode {
  return value.kind === 'BooleanValue';
}

function isIntValue(value: ValueNode): value is IntValueNode {
  return value.kind === 'IntValue';
}

function isFloatValue(value: ValueNode): value is FloatValueNode {
  return value.kind === 'FloatValue';
}

function isVariable(value: ValueNode): value is VariableNode {
  return value.kind === 'Variable';
}

function isObjectValue(value: ValueNode): value is ObjectValueNode {
  return value.kind === 'ObjectValue';
}

function isListValue(value: ValueNode): value is ListValueNode {
  return value.kind === 'ListValue';
}

function isEnumValue(value: ValueNode): value is EnumValueNode {
  return value.kind === 'EnumValue';
}

function isNullValue(value: ValueNode): value is NullValueNode {
  return value.kind === 'NullValue';
}

export function valueToObjectRepresentation(
  argObj: any,
  name: NameNode,
  value: ValueNode,
  variables?: Object,
) {
  if (isIntValue(value) || isFloatValue(value)) {
    argObj[name.value] = Number(value.value);
  } else if (isBooleanValue(value) || isStringValue(value)) {
    argObj[name.value] = value.value;
  } else if (isObjectValue(value)) {
    const nestedArgObj = {};
    value.fields.map(obj =>
      valueToObjectRepresentation(nestedArgObj, obj.name, obj.value, variables),
    );
    argObj[name.value] = nestedArgObj;
  } else if (isVariable(value)) {
    const variableValue = (variables || ({} as any))[value.name.value];
    argObj[name.value] = variableValue;
  } else if (isListValue(value)) {
    argObj[name.value] = value.values.map(listValue => {
      const nestedArgArrayObj = {};
      valueToObjectRepresentation(
        nestedArgArrayObj,
        name,
        listValue,
        variables,
      );
      return (nestedArgArrayObj as any)[name.value];
    });
  } else if (isEnumValue(value)) {
    argObj[name.value] = (value as EnumValueNode).value;
  } else if (isNullValue(value)) {
    argObj[name.value] = null;
  } else {
    throw new InvariantError(
      `The inline argument "${name.value}" of kind "${(value as any).kind}"` +
        'is not supported. Use variables instead of inline arguments to ' +
        'overcome this limitation.',
    );
  }
}

export function storeKeyNameFromField(
  field: FieldNode,
  variables?: Object,
): string {
  let directivesObj: any = null;
  if (field.directives) {
    directivesObj = {};
    field.directives.forEach(directive => {
      directivesObj[directive.name.value] = {};

      if (directive.arguments) {
        directive.arguments.forEach(({ name, value }) =>
          valueToObjectRepresentation(
            directivesObj[directive.name.value],
            name,
            value,
            variables,
          ),
        );
      }
    });
  }

  let argObj: any = null;
  if (field.arguments && field.arguments.length) {
    argObj = {};
    field.arguments.forEach(({ name, value }) =>
      valueToObjectRepresentation(argObj, name, value, variables),
    );
  }

  return getStoreKeyName(field.name.value, argObj, directivesObj);
}

export type Directives = {
  [directiveName: string]: {
    [argName: string]: any;
  };
};

const KNOWN_DIRECTIVES: string[] = [
  'connection',
  'include',
  'skip',
  'client',
  'rest',
  'export',
];

export const getStoreKeyName = Object.assign(function (
  fieldName: string,
  args?: Record<string, any> | null,
  directives?: Directives,
): string {
  if (
    args &&
    directives &&
    directives['connection'] &&
    directives['connection']['key']
  ) {
    if (
      directives['connection']['filter'] &&
      (directives['connection']['filter'] as string[]).length > 0
    ) {
      const filterKeys = directives['connection']['filter']
        ? (directives['connection']['filter'] as string[])
        : [];
      filterKeys.sort();

      const filteredArgs = {} as { [key: string]: any };
      filterKeys.forEach(key => {
        filteredArgs[key] = args[key];
      });

      return `${directives['connection']['key']}(${stringify(
        filteredArgs,
      )})`;
    } else {
      return directives['connection']['key'];
    }
  }

  let completeFieldName: string = fieldName;

  if (args) {
    // We can't use `JSON.stringify` here since it's non-deterministic,
    // and can lead to different store key names being created even though
    // the `args` object used during creation has the same properties/values.
    const stringifiedArgs: string = stringify(args);
    completeFieldName += `(${stringifiedArgs})`;
  }

  if (directives) {
    Object.keys(directives).forEach(key => {
      if (KNOWN_DIRECTIVES.indexOf(key) !== -1) return;
      if (directives[key] && Object.keys(directives[key]).length) {
        completeFieldName += `@${key}(${stringify(directives[key])})`;
      } else {
        completeFieldName += `@${key}`;
      }
    });
  }

  return completeFieldName;
}, {
  setStringify(s: typeof stringify) {
    const previous = stringify;
    stringify = s;
    return previous;
  },
});

// Default stable JSON.stringify implementation. Can be updated/replaced with
// something better by calling getStoreKeyName.setStringify.
let stringify = function defaultStringify(value: any): string {
  return JSON.stringify(value, stringifyReplacer);
};

function stringifyReplacer(_key: string, value: any): any {
  if (isNonNullObject(value) && !Array.isArray(value)) {
    value = Object.keys(value).sort().reduce((copy, key) => {
      copy[key] = value[key];
      return copy;
    }, {} as Record<string, any>);
  }
  return value;
}

export function argumentsObjectFromField(
  field: FieldNode | DirectiveNode,
  variables?: Record<string, any>,
): Object | null {
  if (field.arguments && field.arguments.length) {
    const argObj: Object = {};
    field.arguments.forEach(({ name, value }) =>
      valueToObjectRepresentation(argObj, name, value, variables),
    );
    return argObj;
  }
  return null;
}

export function resultKeyNameFromField(field: FieldNode): string {
  return field.alias ? field.alias.value : field.name.value;
}

export function getTypenameFromResult(
  result: Record<string, any>,
  selectionSet: SelectionSetNode,
  fragmentMap?: FragmentMap,
): string | undefined {
  if (typeof result.__typename === 'string') {
    return result.__typename;
  }

  for (const selection of selectionSet.selections) {
    if (isField(selection)) {
      if (selection.name.value === '__typename') {
        return result[resultKeyNameFromField(selection)];
      }
    } else {
      const typename = getTypenameFromResult(
        result,
        getFragmentFromSelection(selection, fragmentMap)!.selectionSet,
        fragmentMap,
      );
      if (typeof typename === 'string') {
        return typename;
      }
    }
  }
}

export function isField(selection: SelectionNode): selection is FieldNode {
  return selection.kind === 'Field';
}

export function isInlineFragment(
  selection: SelectionNode,
): selection is InlineFragmentNode {
  return selection.kind === 'InlineFragment';
}

export type VariableValue = (node: VariableNode) => any;
