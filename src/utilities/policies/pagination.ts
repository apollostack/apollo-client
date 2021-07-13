import { __rest } from "tslib";

import { FieldPolicy, Reference } from '../../cache';
import { mergeDeep } from '../common/mergeDeep';

type KeyArgs = FieldPolicy<any>["keyArgs"];

// A very basic pagination field policy that always concatenates new
// results onto the existing array, without examining options.args.
export function concatPagination<T = Reference>(
  keyArgs: KeyArgs = false,
): FieldPolicy<T[]> {
  return {
    keyArgs,
    merge(existing, incoming) {
      return existing ? [
        ...existing,
        ...incoming,
      ] : incoming;
    },
  };
}

// A basic field policy that uses options.args.{offset,limit} to splice
// the incoming data into the existing array. If your arguments are called
// something different (like args.{start,count}), feel free to copy/paste
// this implementation and make the appropriate changes.
export function offsetLimitPagination<T = Reference>(
  keyArgs: KeyArgs = false,
): FieldPolicy<T[]> {
  return {
    keyArgs,
    merge(existing, incoming, { args }) {
      const merged = existing ? existing.slice(0) : [];
      if (args) {
        // Assume an offset of 0 if args.offset omitted.
        const { offset = 0 } = args;
        for (let i = 0; i < incoming.length; ++i) {
          merged[offset + i] = incoming[i];
        }
      } else {
        // It's unusual (probably a mistake) for a paginated field not
        // to receive any arguments, so you might prefer to throw an
        // exception here, instead of recovering by appending incoming
        // onto the existing array.
        merged.push.apply(merged, incoming);
      }
      return merged;
    },
  };
}

// Whether TRelayEdge<TNode> is a normalized Reference or a non-normalized
// object, it needs a .cursor property where the relayStylePagination
// merge function can store cursor strings taken from pageInfo. Storing an
// extra reference.cursor property should be safe, and is easier than
// attempting to update the cursor field of the normalized StoreObject
// that the reference refers to, or managing edge wrapper objects
// (something I attempted in #7023, but abandoned because of #7088).
export type TRelayEdge<TNode> = {
  cursor?: string;
  node: TNode;
} | (Reference & { cursor?: string });

export type TRelayPageInfo = {
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  startCursor: string;
  endCursor: string;
};

export type TExistingRelay<TNode> = Readonly<{
  edges: TRelayEdge<TNode>[];
  pageInfo: TRelayPageInfo;
}>;

export type TIncomingRelay<TNode> = {
  edges?: TRelayEdge<TNode>[];
  pageInfo?: TRelayPageInfo;
};

export type RelayFieldPolicy<TNode> = FieldPolicy<
  TExistingRelay<TNode>,
  TIncomingRelay<TNode>,
  TIncomingRelay<TNode>
>;

// As proof of the flexibility of field policies, this function generates
// one that handles Relay-style pagination, without Apollo Client knowing
// anything about connections, edges, cursors, or pageInfo objects.
export function relayStylePagination<TNode = Reference>(
  keyArgs: KeyArgs = false,
): RelayFieldPolicy<TNode> {
  return {
    keyArgs,

    read(existing, { canRead, readField }) {
      if (!existing) return;

      const edges: TRelayEdge<TNode>[] = [];
      let firstEdgeCursor = "";
      let lastEdgeCursor = "";
      existing.edges.forEach(edge => {
        // Edges themselves could be Reference objects, so it's important
        // to use readField to access the edge.edge.node property.
        if (canRead(readField("node", edge))) {
          edges.push(edge);
          if (edge.cursor) {
            firstEdgeCursor = firstEdgeCursor || edge.cursor || "";
            lastEdgeCursor = edge.cursor || lastEdgeCursor;
          }
        }
      });

      const {
        startCursor,
        endCursor,
      } = existing.pageInfo || {};

      return {
        // Some implementations return additional Connection fields, such
        // as existing.totalCount. These fields are saved by the merge
        // function, so the read function should also preserve them.
        ...getExtras(existing),
        edges,
        pageInfo: {
          ...existing.pageInfo,
          // If existing.pageInfo.{start,end}Cursor are undefined or "", default
          // to firstEdgeCursor and/or lastEdgeCursor.
          startCursor: startCursor || firstEdgeCursor,
          endCursor: endCursor || lastEdgeCursor,
        },
      };
    },

    merge(existing = makeEmptyData(), incoming, { args, isReference, readField }) {
      const incomingEdges = incoming.edges ? incoming.edges.map(edge => {
        if (isReference(edge = { ...edge })) {
          // In case edge is a Reference, we read out its cursor field and
          // store it as an extra property of the Reference object.
          edge.cursor = readField<string>("cursor", edge);
        }
        return edge;
      }) : [];

      if (incoming.pageInfo) {
        const { pageInfo } = incoming;
        const { startCursor, endCursor } = pageInfo;
        const firstEdge = incomingEdges[0];
        const lastEdge = incomingEdges[incomingEdges.length - 1];
        // In case we did not request the cursor field for edges in this
        // query, we can still infer cursors from pageInfo.
        if (firstEdge && startCursor) {
          firstEdge.cursor = startCursor;
        }
        if (lastEdge && endCursor) {
          lastEdge.cursor = endCursor;
        }
        // Cursors can also come from edges, so we default
        // pageInfo.{start,end}Cursor to {first,last}Edge.cursor.
        const firstCursor = firstEdge && firstEdge.cursor;
        if (firstCursor && !startCursor) {
          incoming = mergeDeep(incoming, {
            pageInfo: {
              startCursor: firstCursor,
            },
          });
        }
        const lastCursor = lastEdge && lastEdge.cursor;
        if (lastCursor && !endCursor) {
          incoming = mergeDeep(incoming, {
            pageInfo: {
              endCursor: lastCursor,
            },
          });
        }
      }

      let prefix = existing.edges;
      let suffix: typeof prefix = [];

      if (args && args.after) {
        // This comparison does not need to use readField("cursor", edge),
        // because we stored the cursor field of any Reference edges as an
        // extra property of the Reference object.
        const index = prefix.findIndex(edge => edge.cursor === args.after);
        if (index >= 0) {
          prefix = prefix.slice(0, index + 1);
          // suffix = []; // already true
        }
      } else if (args && args.before) {
        const index = prefix.findIndex(edge => edge.cursor === args.before);
        suffix = index < 0 ? prefix : prefix.slice(index);
        prefix = [];
      } else if (incoming.edges) {
        // If we have neither args.after nor args.before, the incoming
        // edges cannot be spliced into the existing edges, so they must
        // replace the existing edges. See #6592 for a motivating example.
        prefix = [];
      }

      const edges = [
        ...prefix,
        ...incomingEdges,
        ...suffix,
      ];

      const pageInfo: TRelayPageInfo = {
        // The ordering of these two ...spreads may be surprising, but it
        // makes sense because we want to combine PageInfo properties with a
        // preference for existing values, *unless* the existing values are
        // overridden by the logic below, which is permitted only when the
        // incoming page falls at the beginning or end of the data.
        ...incoming.pageInfo,
        ...existing.pageInfo,
      };

      if (incoming.pageInfo) {
        const {
          hasPreviousPage, hasNextPage,
          startCursor, endCursor,
          ...extras
        } = incoming.pageInfo;

        // If incoming.pageInfo had any extra non-standard properties,
        // assume they should take precedence over any existing properties
        // of the same name, regardless of where this page falls with
        // respect to the existing data.
        Object.assign(pageInfo, extras);

        // Keep existing.pageInfo.has{Previous,Next}Page unless the
        // placement of the incoming edges means incoming.hasPreviousPage
        // or incoming.hasNextPage should become the new values for those
        // properties in existing.pageInfo. Note that these updates are
        // only permitted when the beginning or end of the incoming page
        // coincides with the beginning or end of the existing data, as
        // determined using prefix.length and suffix.length.
        if (!prefix.length) {
          if (void 0 !== hasPreviousPage) pageInfo.hasPreviousPage = hasPreviousPage;
          if (void 0 !== startCursor) pageInfo.startCursor = startCursor;
        }
        if (!suffix.length) {
          if (void 0 !== hasNextPage) pageInfo.hasNextPage = hasNextPage;
          if (void 0 !== endCursor) pageInfo.endCursor = endCursor;
        }
      }

      return {
        ...getExtras(existing),
        ...getExtras(incoming),
        edges,
        pageInfo,
      };
    },
  };
}

// Returns any unrecognized properties of the given object.
const getExtras = (obj: Record<string, any>) => __rest(obj, notExtras);
const notExtras = ["edges", "pageInfo"];

function makeEmptyData(): TExistingRelay<any> {
  return {
    edges: [],
    pageInfo: {
      hasPreviousPage: false,
      hasNextPage: true,
      startCursor: "",
      endCursor: "",
    },
  };
}
