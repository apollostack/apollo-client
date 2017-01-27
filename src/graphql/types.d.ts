/**
 * This type represents the dynamic form of any data that may be returned from
 * a GraphQL API. Basically this is just a narrower `mixed` type, or another
 * type for JSON.
 */
export type GraphQLData = null | boolean | number | string | GraphQLArrayData | GraphQLObjectData;

/**
 * An that may be returned from a GraphQL API.
 */
export interface GraphQLObjectData { [fieldName: string]: GraphQLData; }

/**
 * A list of values that may be returned from a GraphQL API.
 */
export interface GraphQLArrayData extends Array<GraphQLData> {}
