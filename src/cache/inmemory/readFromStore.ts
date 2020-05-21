import type {
  DocumentNode,
  FieldNode,
  FragmentDefinitionNode,
  InlineFragmentNode,
  SelectionSetNode,
} from 'graphql';
import { wrap, OptimisticWrapperFunction } from 'optimism';
import { invariant, InvariantError } from 'ts-invariant';

import {
  isField,
  isInlineFragment,
  resultKeyNameFromField,
  Reference,
  isReference,
  makeReference,
  StoreObject,
} from '../../utilities/graphql/storeUtils';
import { createFragmentMap, FragmentMap } from '../../utilities/graphql/fragments';
import { shouldInclude } from '../../utilities/graphql/directives';
import { addTypenameToDocument } from '../../utilities/graphql/transform';
import {
  getDefaultValues,
  getFragmentDefinitions,
  getMainDefinition,
  getQueryDefinition,
} from '../../utilities/graphql/getFromAST';
import { maybeDeepFreeze } from '../../utilities/common/maybeDeepFreeze';
import { mergeDeepArray } from '../../utilities/common/mergeDeep';
import type { Cache } from '../core/types/Cache';
import type {
  DiffQueryAgainstStoreOptions,
  ReadQueryOptions,
  NormalizedCache,
} from './types';
import { supportsResultCaching } from './entityStore';
import { getTypenameFromStoreObject } from './helpers';
import type { Policies, ReadMergeContext } from './policies';
import { MissingFieldError } from '../core/types/common';

export type VariableMap = { [name: string]: any };

interface ExecContext extends ReadMergeContext {
  query: DocumentNode;
  store: NormalizedCache;
  policies: Policies;
  fragmentMap: FragmentMap;
  variables: VariableMap;
  path: (string | number)[];
};

export type ExecResult<R = any> = {
  result: R;
  missing?: MissingFieldError[];
};

function missingFromInvariant(
  err: InvariantError,
  context: ExecContext,
) {
  return new MissingFieldError(
    err.message,
    context.path.slice(),
    context.query,
    context.variables,
  );
}

type ExecSelectionSetOptions = {
  selectionSet: SelectionSetNode;
  objectOrReference: StoreObject | Reference;
  context: ExecContext;
};

type ExecSubSelectedArrayOptions = {
  field: FieldNode;
  array: any[];
  context: ExecContext;
};

export interface StoreReaderConfig {
  addTypename?: boolean;
  policies: Policies;
}

export class StoreReader {
  constructor(private config: StoreReaderConfig) {
    this.config = { addTypename: true, ...config };
  }

  /**
   * Resolves the result of a query solely from the store (i.e. never hits the server).
   *
   * @param {Store} store The {@link NormalizedCache} used by Apollo for the `data` portion of the
   * store.
   *
   * @param {DocumentNode} query The query document to resolve from the data available in the store.
   *
   * @param {Object} [variables] A map from the name of a variable to its value. These variables can
   * be referenced by the query document.
   */
  public readQueryFromStore<QueryType>(
    options: ReadQueryOptions,
  ): QueryType | undefined {
    return this.diffQueryAgainstStore<QueryType>({
      ...options,
      returnPartialData: false,
    }).result;
  }

  /**
   * Given a store and a query, return as much of the result as possible and
   * identify if any data was missing from the store.
   * @param  {DocumentNode} query A parsed GraphQL query document
   * @param  {Store} store The Apollo Client store object
   * @return {result: Object, complete: [boolean]}
   */
  public diffQueryAgainstStore<T>({
    store,
    query,
    rootId = 'ROOT_QUERY',
    variables,
    returnPartialData = true,
  }: DiffQueryAgainstStoreOptions): Cache.DiffResult<T> {
    const { policies } = this.config;

    variables = {
      ...getDefaultValues(getQueryDefinition(query)),
      ...variables,
    };

    const execResult = this.executeSelectionSet({
      selectionSet: getMainDefinition(query).selectionSet,
      objectOrReference: makeReference(rootId),
      context: {
        store,
        query,
        policies,
        variables,
        varString: JSON.stringify(variables),
        fragmentMap: createFragmentMap(getFragmentDefinitions(query)),
        toReference: store.toReference,
        getFieldValue: store.getFieldValue,
        path: [],
      },
    });

    const hasMissingFields =
      execResult.missing && execResult.missing.length > 0;
    if (hasMissingFields && !returnPartialData) {
      throw execResult.missing![0];
    }

    return {
      result: execResult.result,
      missing: execResult.missing,
      complete: !hasMissingFields,
    };
  }

  public isFresh(
    result: Record<string, any>,
    store: NormalizedCache,
    parent: StoreObject | Reference,
    selectionSet: SelectionSetNode,
    varString: string,
  ): boolean {
    if (supportsResultCaching(store) &&
        this.knownResults.get(result) === selectionSet) {
      const latest = this.executeSelectionSet.peek(
        store, selectionSet, parent, varString);
      if (latest && result === latest.result) {
        return true;
      }
    }
    return false;
  }

  // Cached version of execSelectionSetImpl.
  private executeSelectionSet: OptimisticWrapperFunction<
    [ExecSelectionSetOptions], // Actual arguments tuple type.
    ExecResult, // Actual return type.
    // Arguments type after keyArgs translation.
    [NormalizedCache, SelectionSetNode, StoreObject | Reference, string]
  > = wrap(options => this.execSelectionSetImpl(options), {
    keyArgs(options) {
      return [
        options.context.store,
        options.selectionSet,
        options.objectOrReference,
        options.context.varString,
      ];
    },
    // Note that the parameters of makeCacheKey are determined by the
    // array returned by keyArgs.
    makeCacheKey(store, selectionSet, parent, varString) {
      if (supportsResultCaching(store)) {
        return store.makeCacheKey(
          selectionSet,
          isReference(parent) ? parent.__ref : parent,
          varString,
        );
      }
    }
  });

  // Uncached version of executeSelectionSet.
  private execSelectionSetImpl({
    selectionSet,
    objectOrReference,
    context,
  }: ExecSelectionSetOptions): ExecResult {
    if (isReference(objectOrReference) &&
        !context.policies.rootTypenamesById[objectOrReference.__ref] &&
        !context.store.has(objectOrReference.__ref)) {
      return {
        result: {},
        missing: [missingFromInvariant(
          new InvariantError(
            `Dangling reference to missing ${objectOrReference.__ref} object`
          ),
          context,
        )],
      };
    }

    const { fragmentMap, variables, policies, store } = context;
    const objectsToMerge: { [key: string]: any }[] = [];
    const finalResult: ExecResult = { result: null };
    const typename = store.getFieldValue<string>(objectOrReference, "__typename");

    if (this.config.addTypename &&
        typeof typename === "string" &&
        !policies.rootIdsByTypename[typename]) {
      // Ensure we always include a default value for the __typename
      // field, if we have one, and this.config.addTypename is true. Note
      // that this field can be overridden by other merged objects.
      objectsToMerge.push({ __typename: typename });
    }

    function getMissing() {
      return finalResult.missing || (finalResult.missing = []);
    }

    function handleMissing<T>(result: ExecResult<T>): T {
      if (result.missing) getMissing().push(...result.missing);
      return result.result;
    }

    const workSet = new Set(selectionSet.selections);

    workSet.forEach(selection => {
      // Omit fields with directives @skip(if: <truthy value>) or
      // @include(if: <falsy value>).
      if (!shouldInclude(selection, variables)) return;

      if (isField(selection)) {
        let fieldValue = policies.readField({
          fieldName: selection.name.value,
          field: selection,
          variables: context.variables,
          from: objectOrReference,
        }, context);

        const resultName = resultKeyNameFromField(selection);
        context.path.push(resultName);

        if (fieldValue === void 0) {
          if (!addTypenameToDocument.added(selection)) {
            getMissing().push(
              missingFromInvariant(
                new InvariantError(`Can't find field '${
                  selection.name.value
                }' on ${
                  isReference(objectOrReference)
                    ? objectOrReference.__ref + " object"
                    : "object " + JSON.stringify(objectOrReference, null, 2)
                }`),
                context,
              ),
            );
          }

        } else if (Array.isArray(fieldValue)) {
          fieldValue = handleMissing(this.executeSubSelectedArray({
            field: selection,
            array: fieldValue,
            context,
          }));

        } else if (!selection.selectionSet) {
          // If the field does not have a selection set, then we handle it
          // as a scalar value. However, that value should not contain any
          // Reference objects, and should be frozen in development, if it
          // happens to be an object that is mutable.
          if (process.env.NODE_ENV !== 'production') {
            assertSelectionSetForIdValue(
              context.store,
              selection,
              fieldValue,
            );
            maybeDeepFreeze(fieldValue);
          }

        } else if (fieldValue != null) {
          // In this case, because we know the field has a selection set,
          // it must be trying to query a GraphQLObjectType, which is why
          // fieldValue must be != null.
          fieldValue = handleMissing(this.executeSelectionSet({
            selectionSet: selection.selectionSet,
            objectOrReference: fieldValue as StoreObject | Reference,
            context,
          }));
        }

        if (fieldValue !== void 0) {
          objectsToMerge.push({ [resultName]: fieldValue });
        }

        invariant(context.path.pop() === resultName);

      } else {
        let fragment: InlineFragmentNode | FragmentDefinitionNode;

        if (isInlineFragment(selection)) {
          fragment = selection;
        } else {
          // This is a named fragment
          invariant(
            fragment = fragmentMap[selection.name.value],
            `No fragment named ${selection.name.value}`,
          );
        }

        if (policies.fragmentMatches(fragment, typename)) {
          fragment.selectionSet.selections.forEach(workSet.add, workSet);
        }
      }
    });

    // Perform a single merge at the end so that we can avoid making more
    // defensive shallow copies than necessary.
    finalResult.result = mergeDeepArray(objectsToMerge);

    if (process.env.NODE_ENV !== 'production') {
      Object.freeze(finalResult.result);
    }

    // Store this result with its selection set so that we can quickly
    // recognize it again in the StoreReader#isFresh method.
    this.knownResults.set(finalResult.result, selectionSet);

    return finalResult;
  }

  private knownResults = new WeakMap<Record<string, any>, SelectionSetNode>();

  // Cached version of execSubSelectedArrayImpl.
  private executeSubSelectedArray = wrap((options: ExecSubSelectedArrayOptions) => {
    return this.execSubSelectedArrayImpl(options);
  }, {
    makeCacheKey({ field, array, context }) {
      if (supportsResultCaching(context.store)) {
        return context.store.makeCacheKey(
          field,
          array,
          context.varString,
        );
      }
    }
  });

  // Uncached version of executeSubSelectedArray.
  private execSubSelectedArrayImpl({
    field,
    array,
    context,
  }: ExecSubSelectedArrayOptions): ExecResult {
    let missing: MissingFieldError[] | undefined;

    function handleMissing<T>(childResult: ExecResult<T>, i: number): T {
      if (childResult.missing) {
        missing = missing || [];
        missing.push(...childResult.missing);
      }

      invariant(context.path.pop() === i);

      return childResult.result;
    }

    array = array.map((item, i) => {
      // null value in array
      if (item === null) {
        return null;
      }

      context.path.push(i);

      // This is a nested array, recurse
      if (Array.isArray(item)) {
        return handleMissing(this.executeSubSelectedArray({
          field,
          array: item,
          context,
        }), i);
      }

      // This is an object, run the selection set on it
      if (field.selectionSet) {
        return handleMissing(this.executeSelectionSet({
          selectionSet: field.selectionSet,
          objectOrReference: item,
          context,
        }), i);
      }

      if (process.env.NODE_ENV !== 'production') {
        assertSelectionSetForIdValue(context.store, field, item);
      }

      invariant(context.path.pop() === i);

      return item;
    });

    if (process.env.NODE_ENV !== 'production') {
      Object.freeze(array);
    }

    return { result: array, missing };
  }
}

function assertSelectionSetForIdValue(
  store: NormalizedCache,
  field: FieldNode,
  fieldValue: any,
) {
  if (!field.selectionSet) {
    const workSet = new Set([fieldValue]);
    workSet.forEach(value => {
      if (value && typeof value === "object") {
        invariant(
          !isReference(value),
          `Missing selection set for object of type ${
            getTypenameFromStoreObject(store, value)
          } returned for query field ${field.name.value}`,
        );
        Object.values(value).forEach(workSet.add, workSet);
      }
    });
  }
}
