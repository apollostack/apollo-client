import { FieldFunctionOptions, InMemoryCache, isReference, makeReference, StoreObject } from '../../../cache';
import { relayStylePagination, TRelayPageInfo } from '../pagination';

describe('relayStylePagination', () => {
  const policy = relayStylePagination();

  describe('read', () => {
    const fakeEdges = [
      { node: { __ref: "A" }, cursor: "cursorA" },
      { node: { __ref: "B" }, cursor: "cursorB" },
      { node: { __ref: "C" }, cursor: "cursorC" },
    ];

    const fakeReadOptions = {
      canRead() { return true },
      readField(key: string, obj: StoreObject) {
        return obj && obj[key];
      },
    } as any as FieldFunctionOptions;

    it("should prefer existing.pageInfo.startCursor", () => {
      const resultWithStartCursor = policy.read!({
        edges: fakeEdges,
        pageInfo: {
          startCursor: "preferredStartCursor",
          hasPreviousPage: false,
          hasNextPage: true,
        } as TRelayPageInfo,
      }, fakeReadOptions);

      expect(
        resultWithStartCursor &&
        resultWithStartCursor.pageInfo
      ).toEqual({
        startCursor: "preferredStartCursor",
        endCursor: "cursorC",
        hasPreviousPage: false,
        hasNextPage: true,
      });
    });

    it("should prefer existing.pageInfo.endCursor", () => {
      const resultWithEndCursor = policy.read!({
        edges: fakeEdges,
        pageInfo: {
          endCursor: "preferredEndCursor",
          hasPreviousPage: false,
          hasNextPage: true,
        } as TRelayPageInfo,
      }, fakeReadOptions);

      expect(
        resultWithEndCursor &&
        resultWithEndCursor.pageInfo
      ).toEqual({
        startCursor: "cursorA",
        endCursor: "preferredEndCursor",
        hasPreviousPage: false,
        hasNextPage: true,
      });
    });

    it("should prefer existing.pageInfo.{start,end}Cursor", () => {
      const resultWithEndCursor = policy.read!({
        edges: fakeEdges,
        pageInfo: {
          startCursor: "preferredStartCursor",
          endCursor: "preferredEndCursor",
          hasPreviousPage: false,
          hasNextPage: true,
        },
      }, fakeReadOptions);

      expect(
        resultWithEndCursor &&
        resultWithEndCursor.pageInfo
      ).toEqual({
        startCursor: "preferredStartCursor",
        endCursor: "preferredEndCursor",
        hasPreviousPage: false,
        hasNextPage: true,
      });
    });

    it("should override pageInfo.{start,end}Cursor if empty strings", () => {
      const resultWithEndCursor = policy.read!({
        edges: [
          { node: { __ref: "A" }, cursor: "" },
          { node: { __ref: "B" }, cursor: "cursorB" },
          { node: { __ref: "C" }, cursor: "" },
          { node: { __ref: "D" }, cursor: "cursorD" },
          { node: { __ref: "E" } },
        ],
        pageInfo: {
          startCursor: "",
          endCursor: "",
          hasPreviousPage: false,
          hasNextPage: true,
        },
      }, fakeReadOptions);

      expect(
        resultWithEndCursor &&
        resultWithEndCursor.pageInfo
      ).toEqual({
        startCursor: "cursorB",
        endCursor: "cursorD",
        hasPreviousPage: false,
        hasNextPage: true,
      });
    });
  });

  describe('merge', () => {
    const merge = policy.merge;
    // The merge function should exist, make TS aware
    if (typeof merge !== 'function') {
      throw new Error('Expecting merge function');
    }

    const options: FieldFunctionOptions = {
      args: null,
      fieldName: 'fake',
      storeFieldName: 'fake',
      field: null,
      isReference: isReference,
      toReference: () => undefined,
      storage: {},
      cache: new InMemoryCache(),
      readField: () => undefined,
      canRead: () => false,
      mergeObjects: (existing, _incoming) => existing,
    };

    it('should maintain endCursor and startCursor with empty edges', () => {
      const incoming: Parameters<typeof merge>[1] = {
        pageInfo: {
          hasPreviousPage: false,
          hasNextPage: true,
          startCursor: 'abc',
          endCursor: 'xyz',
        }
      };
      const result = merge(undefined, incoming, options);
      expect(result).toEqual({
        edges: [],
        pageInfo: {
          hasPreviousPage: false,
          hasNextPage: true,
          startCursor: 'abc',
          endCursor: 'xyz'
        }
      });
    });

    it('should maintain existing PageInfo when adding a page', () => {
      const existingEdges = [
        { cursor: 'alpha', node: makeReference("fakeAlpha") },
      ];

      const incomingEdges = [
        { cursor: 'omega', node: makeReference("fakeOmega") },
      ];

      const result = merge(
        {
          edges: existingEdges,
          pageInfo: {
            hasPreviousPage: false,
            hasNextPage: true,
            startCursor: 'alpha',
            endCursor: 'alpha'
          },
        },
        {
          edges: incomingEdges,
          pageInfo: {
            hasPreviousPage: true,
            hasNextPage: true,
            startCursor: incomingEdges[0].cursor,
            endCursor: incomingEdges[incomingEdges.length - 1].cursor,
          },
        },
        {
          ...options,
          args: {
            after: 'alpha',
          },
        },
      );

      expect(result).toEqual({
        edges: [
          ...existingEdges,
          ...incomingEdges,
        ],
        pageInfo: {
          hasPreviousPage: false,
          hasNextPage: true,
          startCursor: 'alpha',
          endCursor: 'omega',
        }
      });
    });

    it('should maintain extra PageInfo properties', () => {
      const existingEdges = [
        { cursor: 'alpha', node: makeReference("fakeAlpha") },
      ];

      const incomingEdges = [
        { cursor: 'omega', node: makeReference("fakeOmega") },
      ];

      const result = merge(
        {
          edges: existingEdges,
          pageInfo: {
            hasPreviousPage: false,
            hasNextPage: true,
            startCursor: 'alpha',
            endCursor: 'alpha',
            extra: "existing.pageInfo.extra",
          } as TRelayPageInfo,
        },
        {
          edges: incomingEdges,
          pageInfo: {
            hasPreviousPage: true,
            hasNextPage: true,
            startCursor: incomingEdges[0].cursor,
            endCursor: incomingEdges[incomingEdges.length - 1].cursor,
            extra: "incoming.pageInfo.extra",
          } as TRelayPageInfo,
        },
        {
          ...options,
          args: {
            after: 'alpha',
          },
        },
      );

      expect(result).toEqual({
        edges: [
          ...existingEdges,
          ...incomingEdges,
        ],
        pageInfo: {
          hasPreviousPage: false,
          hasNextPage: true,
          startCursor: 'alpha',
          endCursor: 'omega',
          // This is the most important line in this test, since it proves
          // incoming.pageInfo.extra was not lost.
          extra: "incoming.pageInfo.extra",
        }
      });
    });
  })
});
