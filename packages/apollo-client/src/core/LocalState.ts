import {
  ExecutionResult,
  DocumentNode,
  OperationDefinitionNode,
  SelectionSetNode,
  SelectionNode,
  InlineFragmentNode,
  FragmentDefinitionNode,
  FieldNode,
  ASTNode,
} from 'graphql';
import { visit, BREAK } from 'graphql/language/visitor';

import { ApolloCache } from 'apollo-cache';
import {
  getMainDefinition,
  buildQueryFromSelectionSet,
  hasDirectives,
  removeClientSetsFromDocument,
  mergeDeep,
  mergeDeepArray,
  FragmentMap,
  argumentsObjectFromField,
  resultKeyNameFromField,
  getFragmentDefinitions,
  createFragmentMap,
  shouldInclude,
  isField,
  isInlineFragment,
} from 'apollo-utilities';

import { invariant } from 'ts-invariant';

import ApolloClient from '../ApolloClient';
import { Resolvers, OperationVariables } from './types';
import { capitalizeFirstLetter } from '../util/capitalizeFirstLetter';

export type Resolver = (
  rootValue?: any,
  args?: any,
  context?: any,
  info?: {
    field: FieldNode;
    fragmentMap: FragmentMap;
  },
) => any;

export type VariableMap = { [name: string]: any };

export type FragmentMatcher = (
  rootValue: any,
  typeCondition: string,
  context: any,
) => boolean;

export type ExecContext = {
  fragmentMap: FragmentMap;
  context: any;
  variables: VariableMap;
  fragmentMatcher: FragmentMatcher;
  defaultOperationType: string;
  exportedVariables: Record<string, any>;
  onlyRunForcedResolvers: boolean;
};

export type LocalStateOptions<TCacheShape> = {
  cache: ApolloCache<TCacheShape>;
  client?: ApolloClient<TCacheShape>;
  resolvers?: Resolvers | Resolvers[];
  fragmentMatcher?: FragmentMatcher;
};

export class LocalState<TCacheShape> {
  private cache: ApolloCache<TCacheShape>;
  private client: ApolloClient<TCacheShape>;
  private resolvers?: Resolvers;
  private fragmentMatcher: FragmentMatcher;

  constructor({
    cache,
    client,
    resolvers,
    fragmentMatcher,
  }: LocalStateOptions<TCacheShape>) {
    this.cache = cache;

    if (client) {
      this.client = client;
    }

    if (resolvers) {
      this.addResolvers(resolvers);
    }

    if (fragmentMatcher) {
      this.setFragmentMatcher(fragmentMatcher);
    }
  }

  public addResolvers(resolvers: Resolvers | Resolvers[]) {
    this.resolvers = this.resolvers || {};
    if (Array.isArray(resolvers)) {
      resolvers.forEach(resolverGroup => {
        this.resolvers = mergeDeep(this.resolvers, resolverGroup);
      });
    } else {
      this.resolvers = mergeDeep(this.resolvers, resolvers);
    }
  }

  public setResolvers(resolvers: Resolvers | Resolvers[]) {
    this.resolvers = {};
    this.addResolvers(resolvers);
  }

  public getResolvers() {
    return this.resolvers || {};
  }

  // Run local client resolvers against the incoming query and remote data.
  // Locally resolved field values are merged with the incoming remote data,
  // and returned. Note that locally resolved fields will overwrite
  // remote data using the same field name.
  public async runResolvers<TData>({
    document,
    remoteResult,
    context,
    variables,
    onlyRunForcedResolvers = false,
  }: {
    document: DocumentNode | null;
    remoteResult: ExecutionResult<TData>;
    context?: Record<string, any>;
    variables?: Record<string, any>;
    onlyRunForcedResolvers?: boolean;
  }): Promise<ExecutionResult<TData>> {
    if (document) {
      return this.resolveDocument(
        document,
        remoteResult.data,
        context,
        variables,
        this.fragmentMatcher,
        onlyRunForcedResolvers,
      )
        .then(localResult => ({
          ...remoteResult,
          data: localResult.result,
        }))
        .catch(error => ({
          ...remoteResult,
          error,
        }));
    }

    return remoteResult;
  }

  public setFragmentMatcher(fragmentMatcher: FragmentMatcher) {
    this.fragmentMatcher = fragmentMatcher;
  }

  public getFragmentMatcher(): FragmentMatcher {
    return this.fragmentMatcher;
  }

  // Client queries contain everything in the incoming document (if a @client
  // directive is found).
  public clientQuery(document: DocumentNode) {
    if (hasDirectives(['client'], document)) {
      if (this.resolvers) {
        return document;
      }
      invariant.warn(
        'Found @client directives in a query but no ApolloClient resolvers ' +
          'were specified. This means ApolloClient local resolver handling ' +
          'has been disabled, and @client directives will be passed through ' +
          'to your link chain.',
      );
    }
    return null;
  }

  // Server queries are stripped of all @client based selection sets.
  public serverQuery(document: DocumentNode) {
    return this.resolvers ? removeClientSetsFromDocument(document) : document;
  }

  public prepareContext(context = {}) {
    const { cache } = this;

    const newContext = {
      ...context,
      cache,
      // Getting an entry's cache key is useful for local state resolvers.
      getCacheKey: (obj: { __typename: string; id: string | number }) => {
        if ((cache as any).config) {
          return (cache as any).config.dataIdFromObject(obj);
        } else {
          invariant(
            false,
            'To use context.getCacheKey, you need to use a cache that has ' +
              'a configurable dataIdFromObject, like apollo-cache-inmemory.',
          );
        }
      },
    };

    return newContext;
  }

  // To support `@client @export(as: "someVar")` syntax, we'll first resolve
  // @client @export fields locally, then pass the resolved values back to be
  // used alongside the original operation variables.
  public async addExportedVariables(
    document: DocumentNode,
    variables: OperationVariables = {},
    context = {},
  ) {
    if (document) {
      return this.resolveDocument(
        document,
        this.buildRootValueFromCache(document, variables) || {},
        this.prepareContext(context),
        variables,
      ).then(data => ({
        ...variables,
        ...data.exportedVariables,
      }));
    }

    return {
      ...variables,
    };
  }

  public shouldForceResolvers(document: ASTNode) {
    let forceResolvers = false;
    visit(document, {
      Directive: {
        enter(node) {
          if (node.name.value === 'client' && node.arguments) {
            forceResolvers = node.arguments.some(
              arg =>
                arg.name.value === 'always' &&
                arg.value.kind === 'BooleanValue' &&
                arg.value.value === true,
            );
            if (forceResolvers) {
              return BREAK;
            }
          }
        },
      },
    });
    return forceResolvers;
  }

  // Query the cache and return matching data.
  private buildRootValueFromCache(
    document: DocumentNode,
    variables?: Record<string, any>,
  ) {
    return this.cache.diff({
      query: buildQueryFromSelectionSet(document),
      variables,
      returnPartialData: true,
      optimistic: false,
    }).result;
  }

  private async resolveDocument<TData>(
    document: DocumentNode,
    rootValue: TData,
    context: any = {},
    variables: VariableMap = {},
    fragmentMatcher: FragmentMatcher = () => true,
    onlyRunForcedResolvers: boolean = false,
  ) {
    const mainDefinition = getMainDefinition(document);
    const fragments = getFragmentDefinitions(document);
    const fragmentMap = createFragmentMap(fragments);

    const definitionOperation = (mainDefinition as OperationDefinitionNode)
      .operation;

    const defaultOperationType = definitionOperation
      ? capitalizeFirstLetter(definitionOperation)
      : 'Query';

    const { cache, client } = this;
    const execContext: ExecContext = {
      fragmentMap,
      context: {
        ...context,
        cache,
        client,
      },
      variables,
      fragmentMatcher,
      defaultOperationType,
      exportedVariables: {},
      onlyRunForcedResolvers,
    };

    return this.resolveSelectionSet(
      mainDefinition.selectionSet,
      rootValue,
      execContext,
    ).then(result => ({
      result,
      exportedVariables: execContext.exportedVariables,
    }));
  }

  private async resolveSelectionSet<TData>(
    selectionSet: SelectionSetNode,
    rootValue: TData,
    execContext: ExecContext,
  ) {
    const { fragmentMap, context, variables } = execContext;
    const resultsToMerge: TData[] = [rootValue];

    const execute = async (selection: SelectionNode): Promise<void> => {
      if (!shouldInclude(selection, variables)) {
        // Skip this entirely.
        return;
      }

      if (isField(selection)) {
        return this.resolveField(selection, rootValue, execContext).then(
          fieldResult => {
            if (typeof fieldResult !== 'undefined') {
              resultsToMerge.push({
                [resultKeyNameFromField(selection)]: fieldResult,
              } as TData);
            }
          },
        );
      }

      let fragment: InlineFragmentNode | FragmentDefinitionNode;

      if (isInlineFragment(selection)) {
        fragment = selection;
      } else {
        // This is a named fragment.
        fragment = fragmentMap[selection.name.value];
        invariant(fragment, `No fragment named ${selection.name.value}`);
      }

      if (fragment && fragment.typeCondition) {
        const typeCondition = fragment.typeCondition.name.value;
        if (execContext.fragmentMatcher(rootValue, typeCondition, context)) {
          return this.resolveSelectionSet(
            fragment.selectionSet,
            rootValue,
            execContext,
          ).then(fragmentResult => {
            resultsToMerge.push(fragmentResult);
          });
        }
      }
    };

    return Promise.all(selectionSet.selections.map(execute)).then(function() {
      return mergeDeepArray(resultsToMerge);
    });
  }

  private async resolveField(
    field: FieldNode,
    rootValue: any,
    execContext: ExecContext,
  ): Promise<any> {
    const { variables } = execContext;
    const fieldName = field.name.value;
    const aliasedFieldName = resultKeyNameFromField(field);
    const aliasUsed = fieldName !== aliasedFieldName;
    const defaultResult = rootValue[aliasedFieldName] || rootValue[fieldName];
    let resultPromise = Promise.resolve(defaultResult);

    // Usually all local resolvers are run when passing through here, but
    // if we've specifically identified that we only want to run forced
    // resolvers (that is, resolvers for fields marked with
    // `@client(always: true)`), then we'll skip running non-forced resolvers.
    if (
      !execContext.onlyRunForcedResolvers ||
      this.shouldForceResolvers(field)
    ) {
      const resolverType =
        rootValue.__typename || execContext.defaultOperationType;
      const resolverMap = this.resolvers && this.resolvers[resolverType];
      if (resolverMap) {
        const resolve = resolverMap[aliasUsed ? fieldName : aliasedFieldName];
        if (resolve) {
          resultPromise = Promise.resolve(
            resolve(
              rootValue,
              argumentsObjectFromField(field, variables),
              execContext.context,
              { field, fragmentMap: execContext.fragmentMap },
            ),
          );
        }
      }
    }

    return resultPromise.then((result = defaultResult) => {
      // If an @export directive is associated with the current field, store
      // the `as` export variable name and current result for later use.
      if (field.directives) {
        field.directives.forEach(directive => {
          if (directive.name.value === 'export' && directive.arguments) {
            directive.arguments.forEach(arg => {
              if (arg.name.value === 'as' && arg.value.kind === 'StringValue') {
                execContext.exportedVariables[arg.value.value] = result;
              }
            });
          }
        });
      }

      // Handle all scalar types here.
      if (!field.selectionSet) {
        return result;
      }

      // From here down, the field has a selection set, which means it's trying
      // to query a GraphQLObjectType.
      if (result == null) {
        // Basically any field in a GraphQL response can be null, or missing
        return result;
      }

      if (Array.isArray(result)) {
        return this.resolveSubSelectedArray(field, result, execContext);
      }

      // Returned value is an object, and the query has a sub-selection. Recurse.
      if (field.selectionSet) {
        return this.resolveSelectionSet(
          field.selectionSet,
          result,
          execContext,
        );
      }
    });
  }

  private resolveSubSelectedArray(
    field: FieldNode,
    result: any[],
    execContext: ExecContext,
  ): any {
    return Promise.all(
      result.map(item => {
        if (item === null) {
          return null;
        }

        // This is a nested array, recurse.
        if (Array.isArray(item)) {
          return this.resolveSubSelectedArray(field, item, execContext);
        }

        // This is an object, run the selection set on it.
        if (field.selectionSet) {
          return this.resolveSelectionSet(
            field.selectionSet,
            item,
            execContext,
          );
        }
      }),
    );
  }
}
