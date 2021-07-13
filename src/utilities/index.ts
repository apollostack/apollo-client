import { invariant } from "ts-invariant";
import { DEV } from "./globals";
invariant("boolean" === typeof DEV, DEV);
export { DEV }

export {
  DirectiveInfo,
  InclusionDirectives,
  shouldInclude,
  hasDirectives,
  hasClientExports,
  getDirectiveNames,
  getInclusionDirectives,
} from './graphql/directives';

export {
  FragmentMap,
  createFragmentMap,
  getFragmentQueryDocument,
  getFragmentFromSelection,
} from './graphql/fragments';

export {
  checkDocument,
  getOperationDefinition,
  getOperationName,
  getFragmentDefinitions,
  getQueryDefinition,
  getFragmentDefinition,
  getMainDefinition,
  getDefaultValues,
} from './graphql/getFromAST';

export {
  StoreObject,
  Reference,
  StoreValue,
  Directives,
  VariableValue,
  makeReference,
  isDocumentNode,
  isReference,
  isField,
  isInlineFragment,
  valueToObjectRepresentation,
  storeKeyNameFromField,
  argumentsObjectFromField,
  resultKeyNameFromField,
  getStoreKeyName,
  getTypenameFromResult,
} from './graphql/storeUtils';

export {
  RemoveNodeConfig,
  GetNodeConfig,
  RemoveDirectiveConfig,
  GetDirectiveConfig,
  RemoveArgumentsConfig,
  GetFragmentSpreadConfig,
  RemoveFragmentSpreadConfig,
  RemoveFragmentDefinitionConfig,
  RemoveVariableDefinitionConfig,
  addTypenameToDocument,
  buildQueryFromSelectionSet,
  removeDirectivesFromDocument,
  removeConnectionDirectiveFromDocument,
  removeArgumentsFromDocument,
  removeFragmentSpreadFromDocument,
  removeClientSetsFromDocument,
} from './graphql/transform';

export {
  concatPagination,
  offsetLimitPagination,
  relayStylePagination,
} from './policies/pagination';

export {
  Observable,
  Observer,
  ObservableSubscription
} from './observables/Observable';

export * from './common/mergeDeep';
export * from './common/cloneDeep';
export * from './common/maybeDeepFreeze';
export * from './observables/iteration';
export * from './observables/asyncMap';
export * from './observables/Concast';
export * from './observables/subclassing';
export * from './common/arrays';
export * from './common/objects';
export * from './common/errorHandling';
export * from './common/canUse';
export * from './common/compact';
export * from './common/makeUniqueId';

export * from './types/IsStrictlyAny';
