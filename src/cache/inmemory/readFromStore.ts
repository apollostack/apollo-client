import {
  DocumentNode,
  FieldNode,
  SelectionSetNode,
} from 'graphql';
import { wrap, OptimisticWrapperFunction } from 'optimism';
import { invariant, InvariantError } from 'ts-invariant';

import {
  isField,
  resultKeyNameFromField,
  Reference,
  isReference,
  makeReference,
  StoreObject,
  createFragmentMap,
  FragmentMap,
  shouldInclude,
  addTypenameToDocument,
  getDefaultValues,
  getFragmentDefinitions,
  getMainDefinition,
  getQueryDefinition,
  mergeDeepArray,
  getFragmentFromSelection,
  maybeDeepFreeze,
  isNonNullObject,
  canUseWeakMap,
} from '../../utilities';
import { Cache } from '../core/types/Cache';
import {
  DiffQueryAgainstStoreOptions,
  NormalizedCache,
  ReadMergeModifyContext,
} from './types';
import { maybeDependOnExistenceOfEntity, supportsResultCaching } from './entityStore';
import { getTypenameFromStoreObject } from './helpers';
import { Policies } from './policies';
import { InMemoryCache } from './inMemoryCache';
import { MissingFieldError } from '../core/types/common';
import { canonicalStringify, ObjectCanon } from './object-canon';

export type VariableMap = { [name: string]: any };

interface ReadContext extends ReadMergeModifyContext {
  query: DocumentNode;
  policies: Policies;
  canonizeResults: boolean;
  fragmentMap: FragmentMap;
  path: (string | number)[];
};

export type ExecResult<R = any> = {
  result: R;
  missing?: MissingFieldError[];
};

function missingFromInvariant(
  err: InvariantError,
  context: ReadContext,
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
  enclosingRef: Reference;
  context: ReadContext;
};

type ExecSubSelectedArrayOptions = {
  field: FieldNode;
  array: any[];
  enclosingRef: Reference;
  context: ReadContext;
};

export interface StoreReaderConfig {
  cache: InMemoryCache,
  addTypename?: boolean;
  resultCacheMaxSize?: number;
  canon?: ObjectCanon;
}

// Arguments type after keyArgs translation.
type ExecSelectionSetKeyArgs = [
  SelectionSetNode,
  StoreObject | Reference,
  ReadMergeModifyContext,
  boolean,
];

function execSelectionSetKeyArgs(
  options: ExecSelectionSetOptions,
): ExecSelectionSetKeyArgs {
  return [
    options.selectionSet,
    options.objectOrReference,
    options.context,
    // We split out this property so we can pass different values
    // independently without modifying options.context itself.
    options.context.canonizeResults,
  ];
}

export class StoreReader {
  // cached version of executeSelectionset
  private executeSelectionSet: OptimisticWrapperFunction<
    [ExecSelectionSetOptions], // Actual arguments tuple type.
    ExecResult, // Actual return type.
    ExecSelectionSetKeyArgs
  >;

  // cached version of executeSubSelectedArray
  private executeSubSelectedArray: OptimisticWrapperFunction<
    [ExecSubSelectedArrayOptions],
    ExecResult<any>,
    [ExecSubSelectedArrayOptions]>;

  private config: {
    cache: InMemoryCache,
    addTypename: boolean;
    resultCacheMaxSize?: number;
  };

  private knownResults = new (
    canUseWeakMap ? WeakMap : Map
  )<Record<string, any>, SelectionSetNode>();

  public canon: ObjectCanon;
  public resetCanon() {
    this.canon = new ObjectCanon;
  }

  constructor(config: StoreReaderConfig) {
    this.config = {
      ...config,
      addTypename: config.addTypename !== false,
    };

    this.canon = config.canon || new ObjectCanon;

    this.executeSelectionSet = wrap(options => {
      const { canonizeResults } = options.context;

      const peekArgs = execSelectionSetKeyArgs(options);

      // Negate this boolean option so we can find out if we've already read
      // this result using the other boolean value.
      peekArgs[3] = !canonizeResults;

      const other = this.executeSelectionSet.peek(...peekArgs);

      if (other) {
        if (canonizeResults) {
          return {
            ...other,
            // If we previously read this result without canonizing it, we can
            // reuse that result simply by canonizing it now.
            result: this.canon.admit(other.result),
          };
        }
        // If we previously read this result with canonization enabled, we can
        // return that canonized result as-is.
        return other;
      }

      maybeDependOnExistenceOfEntity(
        options.context.store,
        options.enclosingRef.__ref,
      );

      // Finally, if we didn't find any useful previous results, run the real
      // execSelectionSetImpl method with the given options.
      return this.execSelectionSetImpl(options);

    }, {
      max: this.config.resultCacheMaxSize,
      keyArgs: execSelectionSetKeyArgs,
      // Note that the parameters of makeCacheKey are determined by the
      // array returned by keyArgs.
      makeCacheKey(selectionSet, parent, context, canonizeResults) {
        if (supportsResultCaching(context.store)) {
          return context.store.makeCacheKey(
            selectionSet,
            isReference(parent) ? parent.__ref : parent,
            context.varString,
            canonizeResults,
          );
        }
      }
    });

    this.executeSubSelectedArray = wrap((options: ExecSubSelectedArrayOptions) => {
      maybeDependOnExistenceOfEntity(
        options.context.store,
        options.enclosingRef.__ref,
      );
      return this.execSubSelectedArrayImpl(options);
    }, {
      max: this.config.resultCacheMaxSize,
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
    canonizeResults = true,
  }: DiffQueryAgainstStoreOptions): Cache.DiffResult<T> {
    const policies = this.config.cache.policies;

    variables = {
      ...getDefaultValues(getQueryDefinition(query)),
      ...variables!,
    };

    const rootRef = makeReference(rootId);
    const execResult = this.executeSelectionSet({
      selectionSet: getMainDefinition(query).selectionSet,
      objectOrReference: rootRef,
      enclosingRef: rootRef,
      context: {
        store,
        query,
        policies,
        variables,
        varString: canonicalStringify(variables),
        canonizeResults,
        fragmentMap: createFragmentMap(getFragmentDefinitions(query)),
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
    parent: StoreObject | Reference,
    selectionSet: SelectionSetNode,
    context: ReadMergeModifyContext,
  ): boolean {
    if (supportsResultCaching(context.store) &&
        this.knownResults.get(result) === selectionSet) {
      const latest = this.executeSelectionSet.peek(
        selectionSet,
        parent,
        context,
        // If result is canonical, then it could only have been previously
        // cached by the canonizing version of executeSelectionSet, so we can
        // avoid checking both possibilities here.
        this.canon.isKnown(result),
      );
      if (latest && result === latest.result) {
        return true;
      }
    }
    return false;
  }

  // Uncached version of executeSelectionSet.
  private execSelectionSetImpl({
    selectionSet,
    objectOrReference,
    enclosingRef,
    context,
  }: ExecSelectionSetOptions): ExecResult {
    if (isReference(objectOrReference) &&
        !context.policies.rootTypenamesById[objectOrReference.__ref] &&
        !context.store.has(objectOrReference.__ref)) {
      return {
        result: this.canon.empty,
        missing: [missingFromInvariant(
          new InvariantError(
            `Dangling reference to missing ${objectOrReference.__ref} object`
          ),
          context,
        )],
      };
    }

    const { variables, policies, store } = context;
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
            enclosingRef,
            context,
          }));

        } else if (!selection.selectionSet) {
          // If the field does not have a selection set, then we handle it
          // as a scalar value. To keep this.canon from canonicalizing
          // this value, we use this.canon.pass to wrap fieldValue in a
          // Pass object that this.canon.admit will later unwrap as-is.
          if (context.canonizeResults) {
            fieldValue = this.canon.pass(fieldValue);
          }

        } else if (fieldValue != null) {
          // In this case, because we know the field has a selection set,
          // it must be trying to query a GraphQLObjectType, which is why
          // fieldValue must be != null.
          fieldValue = handleMissing(this.executeSelectionSet({
            selectionSet: selection.selectionSet,
            objectOrReference: fieldValue as StoreObject | Reference,
            enclosingRef: isReference(fieldValue) ? fieldValue : enclosingRef,
            context,
          }));
        }

        if (fieldValue !== void 0) {
          objectsToMerge.push({ [resultName]: fieldValue });
        }

        invariant(context.path.pop() === resultName);

      } else {
        const fragment = getFragmentFromSelection(
          selection,
          context.fragmentMap,
        );

        if (fragment && policies.fragmentMatches(fragment, typename)) {
          fragment.selectionSet.selections.forEach(workSet.add, workSet);
        }
      }
    });

    // Perform a single merge at the end so that we can avoid making more
    // defensive shallow copies than necessary.
    const merged = mergeDeepArray(objectsToMerge);
    finalResult.result = context.canonizeResults
      ? this.canon.admit(merged)
      // Since this.canon is normally responsible for freezing results (only in
      // development), freeze them manually if canonization is disabled.
      : maybeDeepFreeze(merged);

    // Store this result with its selection set so that we can quickly
    // recognize it again in the StoreReader#isFresh method.
    this.knownResults.set(finalResult.result, selectionSet);

    return finalResult;
  }

  // Uncached version of executeSubSelectedArray.
  private execSubSelectedArrayImpl({
    field,
    array,
    enclosingRef,
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

    if (field.selectionSet) {
      array = array.filter(context.store.canRead);
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
          enclosingRef,
          context,
        }), i);
      }

      // This is an object, run the selection set on it
      if (field.selectionSet) {
        return handleMissing(this.executeSelectionSet({
          selectionSet: field.selectionSet,
          objectOrReference: item,
          enclosingRef: isReference(item) ? item : enclosingRef,
          context,
        }), i);
      }

      if (__DEV__) {
        assertSelectionSetForIdValue(context.store, field, item);
      }

      invariant(context.path.pop() === i);

      return item;
    });

    return {
      result: context.canonizeResults ? this.canon.admit(array) : array,
      missing,
    };
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
      if (isNonNullObject(value)) {
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
