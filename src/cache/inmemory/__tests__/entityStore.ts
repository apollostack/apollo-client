import gql from 'graphql-tag';
import { EntityStore, supportsResultCaching } from '../entityStore';
import { InMemoryCache } from '../inMemoryCache';
import { DocumentNode } from 'graphql';
import { StoreObject } from '../types';
import { ApolloCache } from '../../core/cache';
import { Cache } from '../../core/types/Cache';
import { Reference, makeReference, isReference } from '../../../utilities/graphql/storeUtils';
import { MissingFieldError } from '../..';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';

describe('EntityStore', () => {
  it('should support result caching if so configured', () => {
    const cache = new InMemoryCache();

    const storeWithResultCaching = new EntityStore.Root({
      policies: cache.policies,
      resultCaching: true,
    });

    const storeWithoutResultCaching = new EntityStore.Root({
      policies: cache.policies,
      resultCaching: false,
    });

    expect(supportsResultCaching({ some: "arbitrary object " })).toBe(false);
    expect(supportsResultCaching(storeWithResultCaching)).toBe(true);
    expect(supportsResultCaching(storeWithoutResultCaching)).toBe(false);

    const layerWithCaching = storeWithResultCaching.addLayer("with caching", () => {});
    expect(supportsResultCaching(layerWithCaching)).toBe(true);
    const anotherLayer = layerWithCaching.addLayer("another layer", () => {});
    expect(supportsResultCaching(anotherLayer)).toBe(true);
    expect(
      anotherLayer
        .removeLayer("with caching")
        .removeLayer("another layer")
    ).toBe(storeWithResultCaching.stump);
    expect(supportsResultCaching(storeWithResultCaching)).toBe(true);

    const layerWithoutCaching = storeWithoutResultCaching.addLayer("with caching", () => {});
    expect(supportsResultCaching(layerWithoutCaching)).toBe(false);
    expect(layerWithoutCaching.removeLayer("with caching")).toBe(storeWithoutResultCaching.stump);
    expect(supportsResultCaching(storeWithoutResultCaching)).toBe(false);
  });

  function newBookAuthorCache() {
    const cache = new InMemoryCache({
      resultCaching: true,
      dataIdFromObject(value: any) {
        switch (value && value.__typename) {
          case 'Book':
            return 'Book:' + value.isbn;
          case 'Author':
            return 'Author:' + value.name;
        }
      },
    });

    const query: TypedDocumentNode<{
      book: {
        __typename: string;
        title: string;
        isbn: string;
        author: {
          __typename: string;
          name: string;
        };
      };
    }> = gql`
      query {
        book {
          title
          author {
            name
          }
        }
      }
    `;

    return {
      cache,
      query,
    };
  }

  it('should reclaim no-longer-reachable, unretained entities', () => {
    const { cache, query } = newBookAuthorCache();

    cache.writeQuery({
      query,
      data: {
        book: {
          __typename: 'Book',
          isbn: '9781451673319',
          title: 'Fahrenheit 451',
          author: {
            __typename: 'Author',
            name: 'Ray Bradbury',
          }
        },
      },
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        book: {
          __ref: "Book:9781451673319",
        },
      },
      "Book:9781451673319": {
        __typename: "Book",
        title: "Fahrenheit 451",
        author: {
          __ref: 'Author:Ray Bradbury',
        }
      },
      "Author:Ray Bradbury": {
        __typename: "Author",
        name: "Ray Bradbury",
      },
    });

    cache.writeQuery({
      query,
      data: {
        book: {
          __typename: 'Book',
          isbn: '0312429215',
          title: '2666',
          author: {
            __typename: 'Author',
            name: 'Roberto Bolaño',
          },
        },
      },
    });

    const snapshot = cache.extract();

    expect(snapshot).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        book: {
          __ref: "Book:0312429215",
        },
      },
      "Book:9781451673319": {
        __typename: "Book",
        title: "Fahrenheit 451",
        author: {
          __ref: 'Author:Ray Bradbury',
        }
      },
      "Author:Ray Bradbury": {
        __typename: "Author",
        name: "Ray Bradbury",
      },
      "Book:0312429215": {
        __typename: "Book",
        author: {
          __ref: "Author:Roberto Bolaño",
        },
        title: "2666",
      },
      "Author:Roberto Bolaño": {
        __typename: "Author",
        name: "Roberto Bolaño",
      },
    });

    const resultBeforeGC = cache.readQuery({ query });

    expect(cache.gc().sort()).toEqual([
      'Author:Ray Bradbury',
      'Book:9781451673319',
    ]);

    const resultAfterGC = cache.readQuery({ query });
    expect(resultBeforeGC).toBe(resultAfterGC);

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        book: {
          __ref: "Book:0312429215",
        },
      },
      "Book:0312429215": {
        __typename: "Book",
        author: {
          __ref: "Author:Roberto Bolaño",
        },
        title: "2666",
      },
      "Author:Roberto Bolaño": {
        __typename: "Author",
        name: "Roberto Bolaño",
      },
    });

    // Nothing left to collect, but let's also reset the result cache to
    // demonstrate that the recomputed cache results are unchanged.
    const originalReader = cache["storeReader"];
    expect(cache.gc({
      resetResultCache: true,
    })).toEqual([]);
    expect(cache["storeReader"]).not.toBe(originalReader);
    const resultAfterResetResultCache = cache.readQuery({ query });
    expect(resultAfterResetResultCache).toBe(resultBeforeGC);
    expect(resultAfterResetResultCache).toBe(resultAfterGC);

    // Now discard cache.storeReader.canon as well.
    expect(cache.gc({
      resetResultCache: true,
      resetResultIdentities: true,
    })).toEqual([]);

    const resultAfterFullGC = cache.readQuery({ query });
    expect(resultAfterFullGC).toEqual(resultBeforeGC);
    expect(resultAfterFullGC).toEqual(resultAfterGC);
    // These !== relations are triggered by passing resetResultIdentities:true
    // to cache.gc, above.
    expect(resultAfterFullGC).not.toBe(resultBeforeGC);
    expect(resultAfterFullGC).not.toBe(resultAfterGC);
    // Result caching immediately begins working again after the intial reset.
    expect(cache.readQuery({ query })).toBe(resultAfterFullGC);

    // Go back to the pre-GC snapshot.
    cache.restore(snapshot);
    expect(cache.extract()).toEqual(snapshot);

    // Reading a specific fragment causes it to be retained during garbage collection.
    const authorNameFragment = gql`
      fragment AuthorName on Author {
        name
      }
    `;
    const ray = cache.readFragment({
      id: 'Author:Ray Bradbury',
      fragment: authorNameFragment,
    });

    expect(cache.retain('Author:Ray Bradbury')).toBe(1);

    expect(ray).toEqual({
      __typename: 'Author',
      name: 'Ray Bradbury',
    });

    expect(cache.gc()).toEqual([
      // Only Fahrenheit 451 (the book) is reclaimed this time.
      'Book:9781451673319',
    ]);

    const rayMeta = {
      extraRootIds: [
        "Author:Ray Bradbury",
      ],
    };

    expect(cache.extract()).toEqual({
      __META: rayMeta,
      ROOT_QUERY: {
        __typename: "Query",
        book: {
          __ref: "Book:0312429215",
        },
      },
      "Author:Ray Bradbury": {
        __typename: "Author",
        name: "Ray Bradbury",
      },
      "Book:0312429215": {
        __typename: "Book",
        author: {
          __ref: "Author:Roberto Bolaño",
        },
        title: "2666",
      },
      "Author:Roberto Bolaño": {
        __typename: "Author",
        name: "Roberto Bolaño",
      },
    });

    expect(cache.gc()).toEqual([]);

    expect(cache.release('Author:Ray Bradbury')).toBe(0);

    expect(cache.gc()).toEqual([
      'Author:Ray Bradbury',
    ]);

    expect(cache.gc()).toEqual([]);
  });

  it('should respect optimistic updates, when active', () => {
    const { cache, query } = newBookAuthorCache();

    cache.writeQuery({
      query,
      data: {
        book: {
          __typename: 'Book',
          isbn: '9781451673319',
          title: 'Fahrenheit 451',
          author: {
            __typename: 'Author',
            name: 'Ray Bradbury',
          }
        },
      },
    });

    expect(cache.gc()).toEqual([]);

    // Orphan the F451 / Ray Bradbury data, but avoid collecting garbage yet.
    cache.writeQuery({
      query,
      data: {
        book: {
          __typename: 'Book',
          isbn: '1980719802',
          title: '1984',
          author: {
            __typename: 'Author',
            name: 'George Orwell',
          },
        }
      }
    });

    cache.recordOptimisticTransaction(proxy => {
      proxy.writeFragment({
        id: 'Author:Ray Bradbury',
        fragment: gql`
          fragment AuthorBooks on Author {
            books {
              title
            }
          }
        `,
        data: {
          books: [
            {
              __typename: 'Book',
              isbn: '9781451673319',
              title: 'Fahrenheit 451',
            },
          ],
        },
      });
    }, "ray books");

    const rayMeta = {
      extraRootIds: [
        "Author:Ray Bradbury",
      ],
    };

    expect(cache.extract(true)).toEqual({
      __META: rayMeta,
      ROOT_QUERY: {
        __typename: "Query",
        book: {
          __ref: "Book:1980719802",
        },
      },
      "Author:Ray Bradbury": {
        __typename: "Author",
        name: "Ray Bradbury",
        books: [
          {
            __ref: "Book:9781451673319",
          },
        ],
      },
      "Book:9781451673319": {
        __typename: "Book",
        title: "Fahrenheit 451",
        author: {
          __ref: "Author:Ray Bradbury",
        },
      },
      "Author:George Orwell": {
        __typename: "Author",
        name: "George Orwell",
      },
      "Book:1980719802": {
        __typename: "Book",
        title: "1984",
        author: {
          __ref: "Author:George Orwell",
        },
      },
    });

    // Nothing can be reclaimed while the optimistic update is retaining
    // Fahrenheit 451.
    expect(cache.gc()).toEqual([]);

    cache.removeOptimistic("ray books");

    expect(cache.extract(true)).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        book: {
          __ref: "Book:1980719802",
        },
      },
      "Author:Ray Bradbury": {
        __typename: "Author",
        name: "Ray Bradbury",
        // Note that the optimistic books field has disappeared, as expected.
      },
      "Book:9781451673319": {
        __typename: "Book",
        title: "Fahrenheit 451",
        author: {
          __ref: "Author:Ray Bradbury",
        },
      },
      "Author:George Orwell": {
        __typename: "Author",
        name: "George Orwell",
      },
      "Book:1980719802": {
        __typename: "Book",
        title: "1984",
        author: {
          __ref: "Author:George Orwell",
        },
      },
    });

    expect(cache.gc().sort()).toEqual([
      "Author:Ray Bradbury",
      "Book:9781451673319",
    ]);

    expect(cache.extract(true)).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        book: {
          __ref: "Book:1980719802",
        },
      },
      "Author:George Orwell": {
        __typename: "Author",
        name: "George Orwell",
      },
      "Book:1980719802": {
        __typename: "Book",
        title: "1984",
        author: {
          __ref: "Author:George Orwell",
        },
      },
    });

    expect(cache.gc()).toEqual([]);
  });

  it('should respect retain/release methods', () => {
    const { query, cache } = newBookAuthorCache();

    const eagerBookData = {
      __typename: 'Book',
      isbn: '1603589082',
      title: 'Eager',
      subtitle: 'The Surprising, Secret Life of Beavers and Why They Matter',
      author: {
        __typename: 'Author',
        name: 'Ben Goldfarb',
      },
    };

    const spinelessBookData = {
      __typename: 'Book',
      isbn: '0735211280',
      title: 'Spineless',
      subtitle: 'The Science of Jellyfish and the Art of Growing a Backbone',
      author: {
        __typename: 'Author',
        name: 'Juli Berwald',
      },
    };

    cache.writeQuery({
      query,
      data: {
        book: spinelessBookData,
      },
    });

    expect(cache.extract(true)).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        book: {
          __ref: "Book:0735211280",
        },
      },
      "Book:0735211280": {
        __typename: "Book",
        author: {
          __ref: "Author:Juli Berwald",
        },
        title: "Spineless",
      },
      "Author:Juli Berwald": {
        __typename: "Author",
        name: "Juli Berwald",
      },
    });

    cache.writeQuery({
      query,
      data: {
        book: eagerBookData,
      },
    });

    const snapshotWithBothBooksAndAuthors = {
      ROOT_QUERY: {
        __typename: "Query",
        book: {
          __ref: "Book:1603589082",
        },
      },
      "Book:0735211280": {
        __typename: "Book",
        author: {
          __ref: "Author:Juli Berwald",
        },
        title: "Spineless",
      },
      "Author:Juli Berwald": {
        __typename: "Author",
        name: "Juli Berwald",
      },
      "Book:1603589082": {
        __typename: "Book",
        author: {
          __ref: "Author:Ben Goldfarb",
        },
        title: "Eager",
      },
      "Author:Ben Goldfarb": {
        __typename: "Author",
        name: "Ben Goldfarb",
      },
    };

    expect(cache.extract(true)).toEqual(snapshotWithBothBooksAndAuthors);

    expect(cache.retain("Book:0735211280")).toBe(1);

    expect(cache.gc()).toEqual([]);

    expect(cache.retain("Author:Juli Berwald")).toBe(1);

    cache.recordOptimisticTransaction(proxy => {
      proxy.writeFragment({
        id: "Author:Juli Berwald",
        fragment: gql`
          fragment AuthorBooks on Author {
            books {
              title
            }
          }
        `,
        data: {
          books: [
            {
              __typename: 'Book',
              isbn: '0735211280',
              title: "Spineless",
            },
          ],
        },
      });
    }, "juli books");

    // Retain the Spineless book on the optimistic layer (for the first time)
    // but release it on the root layer.
    expect(cache.retain("Book:0735211280", true)).toBe(1);
    expect(cache.release("Book:0735211280")).toBe(0);

    // The Spineless book is still protected by the reference from author Juli
    // Berwald's optimistically-added author.books field.
    expect(cache.gc()).toEqual([]);

    const juliBookMeta = {
      extraRootIds: [
        "Author:Juli Berwald",
        "Book:0735211280",
      ],
    };

    expect(cache.extract(true)).toEqual({
      __META: juliBookMeta,
      ROOT_QUERY: {
        __typename: "Query",
        book: {
          __ref: "Book:1603589082",
        },
      },
      "Book:0735211280": {
        __typename: "Book",
        author: {
          __ref: "Author:Juli Berwald",
        },
        title: "Spineless",
      },
      "Author:Juli Berwald": {
        __typename: "Author",
        name: "Juli Berwald",
        // Note this extra optimistic field.
        books: [
          {
            __ref: "Book:0735211280",
          },
        ],
      },
      "Book:1603589082": {
        __typename: "Book",
        author: {
          __ref: "Author:Ben Goldfarb",
        },
        title: "Eager",
      },
      "Author:Ben Goldfarb": {
        __typename: "Author",
        name: "Ben Goldfarb",
      },
    });

    const juliMeta = {
      extraRootIds: [
        "Author:Juli Berwald",
      ],
    };

    // A non-optimistic snapshot will not have the extra books field.
    expect(cache.extract(false)).toEqual({
      ...snapshotWithBothBooksAndAuthors,
      __META: juliMeta,
    });

    cache.removeOptimistic("juli books");

    // The optimistic books field is gone now that we've removed the optimistic
    // layer that added it.
    expect(cache.extract(true)).toEqual({
      ...snapshotWithBothBooksAndAuthors,
      __META: juliMeta,
    });

    // The Spineless book is no longer retained or kept alive by any other root
    // IDs, so it can finally be collected.
    expect(cache.gc()).toEqual([
      "Book:0735211280",
    ]);

    expect(cache.release("Author:Juli Berwald")).toBe(0);

    // Now that Juli Berwald's author entity is no longer retained, garbage
    // collection cometh for her. Look out, Juli!
    expect(cache.gc()).toEqual([
      "Author:Juli Berwald",
    ]);

    expect(cache.gc()).toEqual([]);
  });

  it('allows cache eviction', () => {
    const { cache, query } = newBookAuthorCache();

    const cuckoosCallingBook = {
      __typename: "Book",
      isbn: "031648637X",
      title: "The Cuckoo's Calling",
      author: {
        __typename: "Author",
        name: "Robert Galbraith",
      },
    };

    expect(cache.identify(cuckoosCallingBook)).toBe("Book:031648637X");

    cache.writeQuery({
      query,
      data: {
        book: cuckoosCallingBook,
      },
    });

    expect(cache.evict({ id: "Author:J.K. Rowling" })).toBe(false);

    const bookAuthorFragment = gql`
      fragment BookAuthor on Book {
        author {
          name
        }
      }
    `;

    const fragmentResult = cache.readFragment<StoreObject>({
      id: cache.identify(cuckoosCallingBook)!,
      fragment: bookAuthorFragment,
    });

    expect(fragmentResult).toEqual({
      __typename: "Book",
      author: {
        __typename: "Author",
        name: "Robert Galbraith",
      },
    });

    cache.recordOptimisticTransaction(proxy => {
      proxy.writeFragment({
        id: cache.identify(cuckoosCallingBook)!,
        fragment: bookAuthorFragment,
        data: {
          ...fragmentResult,
          author: {
            __typename: "Author",
            name: "J.K. Rowling",
          },
        },
      });
    }, "real name");

    const snapshotWithBothNames = {
      ROOT_QUERY: {
        __typename: "Query",
        book: {
          __ref: "Book:031648637X",
        },
      },
      "Book:031648637X": {
        __typename: "Book",
        author: {
          __ref: "Author:J.K. Rowling",
        },
        title: "The Cuckoo's Calling",
      },
      "Author:Robert Galbraith": {
        __typename: "Author",
        name: "Robert Galbraith",
      },
      "Author:J.K. Rowling": {
        __typename: "Author",
        name: "J.K. Rowling",
      },
    };

    const cuckooMeta = {
      extraRootIds: [
        "Book:031648637X",
      ],
    };

    expect(cache.extract(true)).toEqual({
      ...snapshotWithBothNames,
      __META: cuckooMeta,
    });

    expect(cache.gc()).toEqual([]);

    expect(cache.retain('Author:Robert Galbraith')).toBe(1);

    expect(cache.gc()).toEqual([]);

    expect(cache.evict({ id: "Author:Robert Galbraith" })).toBe(true);

    expect(cache.gc()).toEqual([]);

    cache.removeOptimistic("real name");

    const robertMeta = {
      extraRootIds: [
        "Author:Robert Galbraith",
      ],
    };

    expect(cache.extract(true)).toEqual({
      __META: robertMeta,
      ROOT_QUERY: {
        __typename: "Query",
        book: {
          __ref: "Book:031648637X",
        },
      },
      "Book:031648637X": {
        __typename: "Book",
        author: {
          __ref: "Author:Robert Galbraith",
        },
        title: "The Cuckoo's Calling",
      },
      // The Robert Galbraith Author record is no longer here because
      // cache.evict evicts data from all EntityStore layers.
    });

    cache.writeFragment({
      id: cache.identify(cuckoosCallingBook)!,
      fragment: bookAuthorFragment,
      data: {
        ...fragmentResult,
        author: {
          __typename: "Author",
          name: "J.K. Rowling",
        },
      },
    });

    const cuckooRobertMeta = {
      ...cuckooMeta,
      ...robertMeta,
      extraRootIds: [
        ...cuckooMeta.extraRootIds,
        ...robertMeta.extraRootIds,
      ].sort(),
    };

    expect(cache.extract(true)).toEqual({
      __META: cuckooRobertMeta,
      ROOT_QUERY: {
        __typename: "Query",
        book: {
          __ref: "Book:031648637X",
        },
      },
      "Book:031648637X": {
        __typename: "Book",
        author: {
          __ref: "Author:J.K. Rowling",
        },
        title: "The Cuckoo's Calling",
      },
      "Author:J.K. Rowling": {
        __typename: "Author",
        name: "J.K. Rowling",
      },
    });

    expect(cache.retain("Author:Robert Galbraith")).toBe(2);

    expect(cache.gc()).toEqual([]);

    expect(cache.release("Author:Robert Galbraith")).toBe(1);
    expect(cache.release("Author:Robert Galbraith")).toBe(0);

    expect(cache.gc()).toEqual([]);

    function checkFalsyEvictId(id: any) {
      expect(id).toBeFalsy();
      expect(cache.evict({
        // Accidentally passing a falsy/undefined options.id to
        // cache.evict (perhaps because cache.identify failed) should
        // *not* cause the ROOT_QUERY object to be evicted! In order for
        // cache.evict to default to ROOT_QUERY, the options.id property
        // must be *absent* (not just undefined).
        id,
      })).toBe(false);
    }
    checkFalsyEvictId(void 0);
    checkFalsyEvictId(null);
    checkFalsyEvictId(false);
    checkFalsyEvictId(0);
    checkFalsyEvictId("");

    // In other words, this is how you evict the entire ROOT_QUERY
    // object. If you're ever tempted to do this, you probably want to use
    // cache.clear() instead, but evicting the ROOT_QUERY should work.
    expect(cache.evict({})).toBe(true);

    expect(cache.extract(true)).toEqual({
      __META: cuckooMeta,
      "Book:031648637X": {
        __typename: "Book",
        author: {
          __ref: "Author:J.K. Rowling",
        },
        title: "The Cuckoo's Calling",
      },
      "Author:J.K. Rowling": {
        __typename: "Author",
        name: "J.K. Rowling",
      },
    });

    const ccId = cache.identify(cuckoosCallingBook)!;
    expect(cache.retain(ccId)).toBe(2);
    expect(cache.release(ccId)).toBe(1);
    expect(cache.release(ccId)).toBe(0);

    expect(cache.gc().sort()).toEqual([
      "Author:J.K. Rowling",
      ccId,
    ]);
  });

  it("ignores retainment count for ROOT_QUERY", () => {
    const { cache, query } = newBookAuthorCache();

    cache.writeQuery({
      query,
      data: {
        book: {
          __typename: "Book",
          isbn: "1982156945",
          title: "Solutions and Other Problems",
          author: {
            __typename: "Author",
            name: "Allie Brosh",
          },
        },
      },
    });

    const allieId = cache.identify({
      __typename: "Author",
      name: "Allie Brosh",
    })!;
    expect(allieId).toBe("Author:Allie Brosh");
    expect(cache.retain(allieId)).toBe(1);

    const snapshot = cache.extract();
    expect(snapshot).toMatchSnapshot();

    expect(cache.gc()).toEqual([]);

    const cache2 = newBookAuthorCache().cache;
    cache2.restore(snapshot);

    expect(cache2.extract()).toEqual(snapshot);

    expect(cache2.gc()).toEqual([]);

    // Evicting the whole ROOT_QUERY object is probably a terrible idea in
    // any real application, but it's worthwhile to test that eviction is
    // stronger than retainment.
    expect(cache2.evict({
      id: "ROOT_QUERY",
    })).toBe(true);

    expect(cache2.gc().sort()).toEqual([
      "Book:1982156945",
    ]);

    expect(cache2.extract()).toMatchSnapshot();

    expect(cache2.release(allieId)).toBe(0);

    expect(cache2.gc().sort()).toEqual([
      "Author:Allie Brosh",
    ]);

    expect(cache2.extract()).toEqual({});
  });

  it("allows evicting specific fields", () => {
    const query: DocumentNode = gql`
      query {
        authorOfBook(isbn: $isbn) {
          name
          hobby
        }
        publisherOfBook(isbn: $isbn) {
          name
          yearOfFounding
        }
      }
    `;

    const cache = new InMemoryCache({
      typePolicies: {
        Query: {
          fields: {
            authorOfBook: {
              keyArgs: ["isbn"],
            },
          },
        },
        Author: {
          keyFields: ["name"],
        },
        Publisher: {
          keyFields: ["name"],
        },
      },
    });

    const TedChiangData = {
      __typename: "Author",
      name: "Ted Chiang",
      hobby: "video games",
    };

    const KnopfData = {
      __typename: "Publisher",
      name: "Alfred A. Knopf",
      yearOfFounding: 1915,
    };

    cache.writeQuery({
      query,
      data: {
        authorOfBook: TedChiangData,
        publisherOfBook: KnopfData,
      },
      variables: {
        isbn: "1529014514",
      },
    });

    const justTedRootQueryData = {
      __typename: "Query",
      'authorOfBook:{"isbn":"1529014514"}': {
        __ref: 'Author:{"name":"Ted Chiang"}',
      },
      // This storeFieldName format differs slightly from that of
      // authorOfBook because we did not define keyArgs for the
      // publisherOfBook field, so the legacy storeKeyNameFromField
      // function was used instead.
      'publisherOfBook({"isbn":"1529014514"})': {
        __ref: 'Publisher:{"name":"Alfred A. Knopf"}',
      },
    };

    expect(cache.extract()).toEqual({
      ROOT_QUERY: justTedRootQueryData,
      'Author:{"name":"Ted Chiang"}': TedChiangData,
      'Publisher:{"name":"Alfred A. Knopf"}': KnopfData,
    });

    const JennyOdellData = {
      __typename: "Author",
      name: "Jenny Odell",
      hobby: "birding",
    };

    const MelvilleData = {
      __typename: "Publisher",
      name: "Melville House",
      yearOfFounding: 2001,
    };

    cache.writeQuery({
      query,
      data: {
        authorOfBook: JennyOdellData,
        publisherOfBook: MelvilleData,
      },
      variables: {
        isbn: "1760641790",
      },
    });

    const justJennyRootQueryData = {
      __typename: "Query",
      'authorOfBook:{"isbn":"1760641790"}': {
        __ref: 'Author:{"name":"Jenny Odell"}',
      },
      'publisherOfBook({"isbn":"1760641790"})': {
        __ref: 'Publisher:{"name":"Melville House"}',
      },
    };

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        ...justTedRootQueryData,
        ...justJennyRootQueryData,
      },
      'Author:{"name":"Ted Chiang"}': TedChiangData,
      'Publisher:{"name":"Alfred A. Knopf"}': KnopfData,
      'Author:{"name":"Jenny Odell"}': JennyOdellData,
      'Publisher:{"name":"Melville House"}': MelvilleData,
    });

    const fullTedResult = cache.readQuery<any>({
      query,
      variables: {
        isbn: "1529014514",
      },
    });

    expect(fullTedResult).toEqual({
      authorOfBook: TedChiangData,
      publisherOfBook: KnopfData,
    });

    const fullJennyResult = cache.readQuery<any>({
      query,
      variables: {
        isbn: "1760641790",
      },
    });

    expect(fullJennyResult).toEqual({
      authorOfBook: JennyOdellData,
      publisherOfBook: MelvilleData,
    });

    cache.evict({
      id: cache.identify({
        __typename: "Publisher",
        name: "Alfred A. Knopf",
      })!,
      fieldName: "yearOfFounding",
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        ...justTedRootQueryData,
        ...justJennyRootQueryData,
      },
      'Author:{"name":"Ted Chiang"}': TedChiangData,
      'Publisher:{"name":"Alfred A. Knopf"}': {
        __typename: "Publisher",
        name: "Alfred A. Knopf",
        // yearOfFounding has been removed
      },
      'Author:{"name":"Jenny Odell"}': JennyOdellData,
      'Publisher:{"name":"Melville House"}': MelvilleData,
    });

    // Nothing to garbage collect yet.
    expect(cache.gc()).toEqual([]);

    cache.evict({
      id: cache.identify({
        __typename: "Publisher",
        name: "Melville House",
      })!,
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        ...justTedRootQueryData,
        ...justJennyRootQueryData,
      },
      'Author:{"name":"Ted Chiang"}': TedChiangData,
      'Publisher:{"name":"Alfred A. Knopf"}': {
        __typename: "Publisher",
        name: "Alfred A. Knopf",
      },
      'Author:{"name":"Jenny Odell"}': JennyOdellData,
      // Melville House has been removed
    });

    cache.evict({ id: "ROOT_QUERY", fieldName: "publisherOfBook" });

    function withoutPublisherOfBook(obj: Record<string, any>) {
      const clean = { ...obj };
      Object.keys(obj).forEach(key => {
        if (key.startsWith("publisherOfBook")) {
          delete clean[key];
        }
      });
      return clean;
    }

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        ...withoutPublisherOfBook(justTedRootQueryData),
        ...withoutPublisherOfBook(justJennyRootQueryData),
      },
      'Author:{"name":"Ted Chiang"}': TedChiangData,
      'Publisher:{"name":"Alfred A. Knopf"}': {
        __typename: "Publisher",
        name: "Alfred A. Knopf",
      },
      'Author:{"name":"Jenny Odell"}': JennyOdellData,
    });

    expect(cache.gc()).toEqual([
      'Publisher:{"name":"Alfred A. Knopf"}',
    ]);

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        ...withoutPublisherOfBook(justTedRootQueryData),
        ...withoutPublisherOfBook(justJennyRootQueryData),
      },
      'Author:{"name":"Ted Chiang"}': TedChiangData,
      'Author:{"name":"Jenny Odell"}': JennyOdellData,
    });

    const partialTedResult = cache.diff<any>({
      query,
      returnPartialData: true,
      optimistic: false, // required but not important
      variables: {
        isbn: "1529014514",
      },
    });
    expect(partialTedResult.complete).toBe(false);
    expect(partialTedResult.result).toEqual({
      authorOfBook: TedChiangData,
    });
    // The result caching system preserves the referential identity of
    // unchanged nested result objects.
    expect(
      partialTedResult.result.authorOfBook,
    ).toBe(fullTedResult.authorOfBook);

    const partialJennyResult = cache.diff<any>({
      query,
      returnPartialData: true,
      optimistic: true, // required but not important
      variables: {
        isbn: "1760641790",
      },
    });
    expect(partialJennyResult.complete).toBe(false);
    expect(partialJennyResult.result).toEqual({
      authorOfBook: JennyOdellData,
    });
    // The result caching system preserves the referential identity of
    // unchanged nested result objects.
    expect(
      partialJennyResult.result.authorOfBook,
    ).toBe(fullJennyResult.authorOfBook);

    const tedWithoutHobby = {
      __typename: "Author",
      name: "Ted Chiang",
    };

    cache.evict({
      id: cache.identify(tedWithoutHobby)!,
      fieldName: "hobby",
    });

    expect(cache.diff<any>({
      query,
      returnPartialData: true,
      optimistic: false, // required but not important
      variables: {
        isbn: "1529014514",
      },
    })).toEqual({
      complete: false,
      result: {
        authorOfBook: tedWithoutHobby,
      },
      missing: [
        new MissingFieldError(
          'Can\'t find field \'hobby\' on Author:{"name":"Ted Chiang"} object',
          ["authorOfBook", "hobby"],
          expect.anything(), // query
          expect.anything(), // variables
        ),
        new MissingFieldError(
          'Can\'t find field \'publisherOfBook\' on ROOT_QUERY object',
          ["publisherOfBook"],
          expect.anything(), // query
          expect.anything(), // variables
        ),
      ],
    });

    cache.evict({ id: "ROOT_QUERY", fieldName: "authorOfBook"});
    expect(cache.gc().sort()).toEqual([
      'Author:{"name":"Jenny Odell"}',
      'Author:{"name":"Ted Chiang"}',
    ]);
    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        // Everything else has been removed.
        __typename: "Query",
      },
    });
  });

  it("allows evicting specific fields with specific arguments", () => {
    const query: DocumentNode = gql`
      query {
        authorOfBook(isbn: $isbn) {
          name
          hobby
        }
      }
    `;

    const cache = new InMemoryCache();

    const TedChiangData = {
      __typename: "Author",
      name: "Ted Chiang",
      hobby: "video games",
    };

    const IsaacAsimovData = {
      __typename: "Author",
      name: "Isaac Asimov",
      hobby: "chemistry",
    };

    const JamesCoreyData = {
      __typename: "Author",
      name: "James S.A. Corey",
      hobby: "tabletop games",
    };

    cache.writeQuery({
      query,
      data: {
        authorOfBook: TedChiangData,
      },
      variables: {
        isbn: "1",
      },
    });

    cache.writeQuery({
      query,
      data: {
        authorOfBook: IsaacAsimovData,
      },
      variables: {
        isbn: "2",
      },
    });

    cache.writeQuery({
      query,
      data: {
        authorOfBook: JamesCoreyData,
      },
      variables: {},
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        "authorOfBook({\"isbn\":\"1\"})": {
          __typename: "Author",
          name: "Ted Chiang",
          hobby: "video games",
        },
        "authorOfBook({\"isbn\":\"2\"})": {
          __typename: "Author",
          name: "Isaac Asimov",
          hobby: "chemistry",
        },
        "authorOfBook({})": {
          __typename: "Author",
          name: "James S.A. Corey",
          hobby: "tabletop games",
        }
      },
    });

    cache.evict({
      fieldName: 'authorOfBook',
      args: { isbn: "1" },
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        "authorOfBook({\"isbn\":\"2\"})": {
          __typename: "Author",
          name: "Isaac Asimov",
          hobby: "chemistry",
        },
        "authorOfBook({})": {
          __typename: "Author",
          name: "James S.A. Corey",
          hobby: "tabletop games",
        }
      },
    });

    cache.evict({
      fieldName: 'authorOfBook',
      args: { isbn: '3' },
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        "authorOfBook({\"isbn\":\"2\"})": {
          __typename: "Author",
          name: "Isaac Asimov",
          hobby: "chemistry",
        },
        "authorOfBook({})": {
          __typename: "Author",
          name: "James S.A. Corey",
          hobby: "tabletop games",
        }
      },
    });

    cache.evict({
      fieldName: 'authorOfBook',
      args: {},
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        "authorOfBook({\"isbn\":\"2\"})": {
          __typename: "Author",
          name: "Isaac Asimov",
          hobby: "chemistry",
        },
      },
    });

    cache.evict({
      fieldName: 'authorOfBook',
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
      },
    });
  });

  it("allows evicting specific fields with specific arguments using EvictOptions", () => {
    const query: DocumentNode = gql`
      query {
        authorOfBook(isbn: $isbn) {
          name
          hobby
        }
      }
    `;

    const cache = new InMemoryCache();

    const TedChiangData = {
      __typename: "Author",
      name: "Ted Chiang",
      hobby: "video games",
    };

    const IsaacAsimovData = {
      __typename: "Author",
      name: "Isaac Asimov",
      hobby: "chemistry",
    };

    const JamesCoreyData = {
      __typename: "Author",
      name: "James S.A. Corey",
      hobby: "tabletop games",
    };

    cache.writeQuery({
      query,
      data: {
        authorOfBook: TedChiangData,
      },
      variables: {
        isbn: "1",
      },
    });

    cache.writeQuery({
      query,
      data: {
        authorOfBook: IsaacAsimovData,
      },
      variables: {
        isbn: "2",
      },
    });

    cache.writeQuery({
      query,
      data: {
        authorOfBook: JamesCoreyData,
      },
      variables: {},
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        "authorOfBook({\"isbn\":\"1\"})": {
          __typename: "Author",
          name: "Ted Chiang",
          hobby: "video games",
        },
        "authorOfBook({\"isbn\":\"2\"})": {
          __typename: "Author",
          name: "Isaac Asimov",
          hobby: "chemistry",
        },
        "authorOfBook({})": {
          __typename: "Author",
          name: "James S.A. Corey",
          hobby: "tabletop games",
        }
      },
    });

    cache.evict({
      id: 'ROOT_QUERY',
      fieldName: 'authorOfBook',
      args: { isbn: "1" },
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        "authorOfBook({\"isbn\":\"2\"})": {
          __typename: "Author",
          name: "Isaac Asimov",
          hobby: "chemistry",
        },
        "authorOfBook({})": {
          __typename: "Author",
          name: "James S.A. Corey",
          hobby: "tabletop games",
        }
      },
    });

    cache.evict({
      id: 'ROOT_QUERY',
      fieldName: 'authorOfBook',
      args: { isbn: '3' },
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        "authorOfBook({\"isbn\":\"2\"})": {
          __typename: "Author",
          name: "Isaac Asimov",
          hobby: "chemistry",
        },
        "authorOfBook({})": {
          __typename: "Author",
          name: "James S.A. Corey",
          hobby: "tabletop games",
        }
      },
    });

    cache.evict({
      id: 'ROOT_QUERY',
      fieldName: 'authorOfBook',
      args: {},
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        "authorOfBook({\"isbn\":\"2\"})": {
          __typename: "Author",
          name: "Isaac Asimov",
          hobby: "chemistry",
        },
      },
    });

    cache.evict({
      id: 'ROOT_QUERY',
      fieldName: 'authorOfBook',
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
      },
    });
  });

  it("supports cache.identify(reference)", () => {
    const cache = new InMemoryCache({
      typePolicies: {
        Task: {
          keyFields: ["uuid"],
        },
      },
    });

    expect(cache.identify(makeReference("oyez"))).toBe("oyez");

    const todoRef = cache.writeFragment({
      fragment: gql`fragment TodoId on Todo { id }`,
      data: {
        __typename: "Todo",
        id: 123,
      },
    });
    expect(isReference(todoRef)).toBe(true);
    expect(cache.identify(todoRef!)).toBe("Todo:123");

    const taskRef = cache.writeFragment({
      fragment: gql`fragment TaskId on Task { uuid }`,
      data: {
        __typename: "Task",
        uuid: "eb8cffcc-7a9e-4d8b-a517-7d987bf42138",
      },
    });
    expect(isReference(taskRef)).toBe(true);
    expect(cache.identify(taskRef!)).toBe(
      'Task:{"uuid":"eb8cffcc-7a9e-4d8b-a517-7d987bf42138"}');
  });

  it("supports cache.identify(object)", () => {
    const queryWithAliases: DocumentNode = gql`
      query {
        abcs {
          first: a
          second: b
          ...Rest
        }
      }
      fragment Rest on ABCs {
        third: c
      }
    `;

    const queryWithoutAliases: DocumentNode = gql`
      query {
        abcs {
          a
          b
          ...Rest
        }
      }
      fragment Rest on ABCs {
        c
      }
    `;

    const cache = new InMemoryCache({
      typePolicies: {
        ABCs: {
          keyFields: ["b", "a", "c"],
        },
      },
    });

    const ABCs = {
      __typename: "ABCs",
      first: "ay",
      second: "bee",
      third: "see",
    };

    cache.writeQuery({
      query: queryWithAliases,
      data: {
        abcs: ABCs,
      },
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        abcs: {
          __ref: 'ABCs:{"b":"bee","a":"ay","c":"see"}',
        },
      },
      'ABCs:{"b":"bee","a":"ay","c":"see"}': {
        __typename: "ABCs",
        a: "ay",
        b: "bee",
        c: "see",
      },
    });

    const resultWithAliases = cache.readQuery({
      query: queryWithAliases,
    });

    expect(resultWithAliases).toEqual({ abcs: ABCs });

    const resultWithoutAliases = cache.readQuery({
      query: queryWithoutAliases,
    });

    expect(resultWithoutAliases).toEqual({
      abcs: {
        __typename: "ABCs",
        a: "ay",
        b: "bee",
        c: "see",
      },
    });

    expect(cache.identify({
      __typename: "ABCs",
      a: 1,
      b: 2,
      c: 3,
    })).toBe('ABCs:{"b":2,"a":1,"c":3}');

    expect(() => cache.identify(ABCs)).toThrowError(
      "Missing field 'b' while computing key fields",
    );

    expect(cache.readFragment({
      id: cache.identify({
        __typename: "ABCs",
        a: "ay",
        b: "bee",
        c: "see",
      })!,
      fragment: gql`
        fragment JustB on ABCs {
          b
        }
      `,
    })).toEqual({
      __typename: "ABCs",
      b: "bee",
    });

    expect(cache.readQuery({
      query: queryWithAliases,
    })).toBe(resultWithAliases);

    expect(cache.readQuery({
      query: queryWithoutAliases,
    })).toBe(resultWithoutAliases);

    cache.evict({
      id: cache.identify({
        __typename: "ABCs",
        a: "ay",
        b: "bee",
        c: "see",
      }),
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        abcs: {
          __ref: 'ABCs:{"b":"bee","a":"ay","c":"see"}',
        },
      },
    });

    function diff(query: DocumentNode) {
      return cache.diff({
        query,
        optimistic: true,
        returnPartialData: false,
      });
    }

    expect(cache.readQuery({
      query: queryWithAliases,
    })).toBe(null);

    expect(() => diff(queryWithAliases)).toThrow(
      /Dangling reference to missing ABCs:.* object/,
    );

    expect(cache.readQuery({
      query: queryWithoutAliases,
    })).toBe(null);

    expect(() => diff(queryWithoutAliases)).toThrow(
      /Dangling reference to missing ABCs:.* object/,
    );
  });

  it("gracefully handles eviction amid optimistic updates", () => {
    const cache = new InMemoryCache;
    const query = gql`
      query {
        book {
          author {
            name
          }
        }
      }
    `;

    function writeInitialData(cache: ApolloCache<any>) {
      cache.writeQuery({
        query,
        data: {
          book: {
            __typename: "Book",
            id: 1,
            author: {
              __typename: "Author",
              id: 2,
              name: "Geoffrey Chaucer",
            },
          },
        },
      });
    }

    writeInitialData(cache);

    // Writing data in an optimistic transaction to exercise the
    // interaction between eviction and optimistic layers.
    cache.recordOptimisticTransaction(proxy => {
      writeInitialData(proxy);
    }, "initial transaction");

    expect(cache.extract(true)).toEqual({
      "Author:2": {
        __typename: "Author",
        id: 2,
        name: "Geoffrey Chaucer",
      },
      "Book:1": {
        __typename: "Book",
        id: 1,
        author: { __ref: "Author:2" },
      },
      ROOT_QUERY: {
        __typename: "Query",
        book: { __ref: "Book:1" },
      },
    });

    const authorId = cache.identify({
      __typename: "Author",
      id: 2,
    })!;

    expect(cache.evict({ id: authorId })).toBe(true);

    expect(cache.extract(true)).toEqual({
      "Book:1": {
        __typename: "Book",
        id: 1,
        author: { __ref: "Author:2" },
      },
      ROOT_QUERY: {
        __typename: "Query",
        book: { __ref: "Book:1" },
      },
    });

    expect(cache.evict({ id: authorId })).toBe(false);

    const missing = [
      new MissingFieldError(
        "Dangling reference to missing Author:2 object",
        ["book", "author"],
        expect.anything(), // query
        expect.anything(), // variables
      ),
    ];

    expect(cache.diff({
      query,
      optimistic: true,
      returnPartialData: true,
    })).toEqual({
      complete: false,
      missing,
      result: {
        book: {
          __typename: "Book",
          author: {},
        },
      },
    });

    cache.removeOptimistic("initial transaction");

    // The root layer is exposed again once the optimistic layer is
    // removed, but the Author:2 entity has been evicted from all layers.
    expect(cache.extract(true)).toEqual({
      "Book:1": {
        __typename: "Book",
        id: 1,
        author: { __ref: "Author:2" },
      },
      ROOT_QUERY: {
        __typename: "Query",
        book: { __ref: "Book:1" },
      },
    });

    expect(cache.diff({
      query,
      optimistic: true,
      returnPartialData: true,
    })).toEqual({
      complete: false,
      missing,
      result: {
        book: {
          __typename: "Book",
          author: {},
        },
      },
    });

    writeInitialData(cache);

    expect(cache.diff({
      query,
      optimistic: true,
      returnPartialData: true,
    })).toEqual({
      complete: true,
      result: {
        book: {
          __typename: "Book",
          author: {
            __typename: "Author",
            name: "Geoffrey Chaucer",
          },
        },
      },
    });
  });

  it("supports toReference(obj, true) to persist obj", () => {
    const cache = new InMemoryCache({
      typePolicies: {
        Query: {
          fields: {
            book(_, {
              args,
              toReference,
              readField,
            }) {
              const ref = toReference({
                __typename: "Book",
                isbn: args!.isbn,
              }, true) as Reference;

              expect(readField("__typename", ref)).toEqual("Book");
              const isbn = readField<string>("isbn", ref);
              expect(isbn).toEqual(args!.isbn);
              expect(readField("title", ref)).toBe(titlesByISBN.get(isbn!));

              return ref;
            },

            books: {
              merge(existing: Reference[] = [], incoming: any[], {
                isReference,
                toReference,
                readField,
              }) {
                incoming.forEach(book => {
                  expect(isReference(book)).toBe(false);
                  expect(book.__typename).toBeUndefined();
                });

                const refs = incoming.map(book => toReference({
                  __typename: "Book",
                  title: titlesByISBN.get(book.isbn),
                  ...book,
                }, true) as Reference);

                refs.forEach((ref, i) => {
                  expect(isReference(ref)).toBe(true);
                  expect(readField("__typename", ref)).toBe("Book");
                  const isbn = readField<string>("isbn", ref);
                  expect(typeof isbn).toBe("string");
                  expect(isbn).toBe(readField("isbn", incoming[i]));
                });

                return [...existing, ...refs];
              },
            },
          },
        },

        Book: {
          keyFields: ["isbn"],
        },
      },
    });

    const booksQuery = gql`
      query {
        books {
          isbn
        }
      }
    `;

    const bookQuery = gql`
      query {
        book(isbn: $isbn) {
          isbn
          title
        }
      }
    `;

    const titlesByISBN = new Map<string, string>([
      ["9781451673319", 'Fahrenheit 451'],
      ["1603589082", 'Eager'],
      ["1760641790", 'How To Do Nothing'],
    ]);

    cache.writeQuery({
      query: booksQuery,
      data: {
        books: [{
          // Note: intentionally omitting __typename:"Book" here.
          isbn: "9781451673319",
        }, {
          isbn: "1603589082",
        }],
      },
    });

    const twoBookSnapshot = {
      ROOT_QUERY: {
        __typename: "Query",
        books: [
          { __ref: 'Book:{"isbn":"9781451673319"}' },
          { __ref: 'Book:{"isbn":"1603589082"}' },
        ],
      },
      'Book:{"isbn":"9781451673319"}': {
        __typename: "Book",
        isbn: "9781451673319",
        title: "Fahrenheit 451",
      },
      'Book:{"isbn":"1603589082"}': {
        __typename: "Book",
        isbn: "1603589082",
        title: "Eager",
      },
    };

    // Check that the __typenames were appropriately added.
    expect(cache.extract()).toEqual(twoBookSnapshot);

    cache.writeQuery({
      query: booksQuery,
      data: {
        books: [{
          isbn: "1760641790",
        }],
      },
    });

    const threeBookSnapshot = {
      ...twoBookSnapshot,
      ROOT_QUERY: {
        ...twoBookSnapshot.ROOT_QUERY,
        books: [
          ...twoBookSnapshot.ROOT_QUERY.books,
          { __ref: 'Book:{"isbn":"1760641790"}' },
        ],
      },
      'Book:{"isbn":"1760641790"}': {
        __typename: "Book",
        isbn: "1760641790",
        title: "How To Do Nothing",
      },
    };

    expect(cache.extract()).toEqual(threeBookSnapshot);

    const howToDoNothingResult = cache.readQuery({
      query: bookQuery,
      variables: {
        isbn: "1760641790",
      },
    });

    expect(howToDoNothingResult).toEqual({
      book: {
        __typename: "Book",
        isbn: "1760641790",
        title: "How To Do Nothing",
      },
    });

    // Check that reading the query didn't change anything.
    expect(cache.extract()).toEqual(threeBookSnapshot);

    const f451Result = cache.readQuery({
      query: bookQuery,
      variables: {
        isbn: "9781451673319",
      },
    });

    expect(f451Result).toEqual({
      book: {
        __typename: "Book",
        isbn: "9781451673319",
        title: "Fahrenheit 451",
      },
    });

    const cuckoosCallingDiffResult = cache.diff({
      query: bookQuery,
      optimistic: true,
      variables: {
        isbn: "031648637X",
      },
    });

    expect(cuckoosCallingDiffResult).toEqual({
      complete: false,
      result: {
        book: {
          __typename: "Book",
          isbn: "031648637X",
        },
      },
      missing: [
        new MissingFieldError(
          'Can\'t find field \'title\' on Book:{"isbn":"031648637X"} object',
          ["book", "title"],
          expect.anything(), // query
          expect.anything(), // variables
        ),
      ],
    });

    expect(cache.extract()).toEqual({
      ...threeBookSnapshot,
      // This book was added as a side effect of the read function.
      'Book:{"isbn":"031648637X"}': {
        __typename: "Book",
        isbn: "031648637X",
      },
    });

    const cuckoosCallingId = cache.identify({
      __typename: "Book",
      isbn: "031648637X",
    })!;

    expect(cuckoosCallingId).toBe('Book:{"isbn":"031648637X"}');

    cache.writeQuery({
      id: cuckoosCallingId,
      query: gql`{ title }`,
      data: {
        title: "The Cuckoo's Calling",
      },
    });

    const cuckooMeta = {
      extraRootIds: [
        'Book:{"isbn":"031648637X"}',
      ],
    };

    expect(cache.extract()).toEqual({
      ...threeBookSnapshot,
      __META: cuckooMeta,
      // This book was added as a side effect of the read function.
      'Book:{"isbn":"031648637X"}': {
        __typename: "Book",
        isbn: "031648637X",
        title: "The Cuckoo's Calling",
      },
    });

    cache.modify({
      id: cuckoosCallingId,
      fields: {
        title(title: string, {
          isReference,
          toReference,
          readField,
        }) {
          const book = {
            __typename: "Book",
            isbn: readField("isbn"),
            author: "J.K. Rowling",
          };

          // By not passing true as the second argument to toReference, we
          // get back a Reference object, but the book.author field is not
          // persisted into the store.
          const refWithoutAuthor = toReference(book);
          expect(isReference(refWithoutAuthor)).toBe(true);
          expect(readField("author", refWithoutAuthor as Reference)).toBeUndefined();

          // Update this very Book entity before we modify its title.
          // Passing true for the second argument causes the extra
          // book.author field to be persisted into the store.
          const ref = toReference(book, true);
          expect(isReference(ref)).toBe(true);
          expect(readField("author", ref as Reference)).toBe("J.K. Rowling");

          // In fact, readField doesn't need the ref if we're reading from
          // the same entity that we're modifying.
          expect(readField("author")).toBe("J.K. Rowling");

          // Typography matters!
          return title.split("'").join("’");
        },
      },
    });

    expect(cache.extract()).toEqual({
      ...threeBookSnapshot,
      __META: cuckooMeta,
      // This book was added as a side effect of the read function.
      'Book:{"isbn":"031648637X"}': {
        __typename: "Book",
        isbn: "031648637X",
        title: "The Cuckoo’s Calling",
        author: "J.K. Rowling",
      },
    });
  });

  it("supports toReference(id)", () => {
    const cache = new InMemoryCache({
      typePolicies: {
        Book: {
          fields: {
            favorited(_, { readField, toReference }) {
              const rootQueryRef = toReference("ROOT_QUERY");
              expect(rootQueryRef).toEqual(makeReference("ROOT_QUERY"));
              const favoritedBooks = readField<Reference[]>("favoritedBooks", rootQueryRef);
              return favoritedBooks!.some(bookRef => {
                return readField("isbn") === readField("isbn", bookRef);
              });
            },
          },
          keyFields: ["isbn"],
        },
        Query: {
          fields: {
            book(_, {
              args,
              toReference,
            }) {
              const ref = toReference({
                __typename: "Book",
                isbn: args!.isbn,
                title: titlesByISBN.get(args!.isbn),
              }, true);

              return ref;
            },
          },
        }
      }
    });

    cache.writeQuery({
      query: gql`{
        favoritedBooks {
          isbn
          title
        }
      }`,
      data: {
        favoritedBooks: [{
          __typename: "Book",
          isbn: "9781784295547",
          title: "Shrill",
          author: "Lindy West",
        }],
      },
    });

    const titlesByISBN = new Map<string, string>([
      ["9780062569714", 'Hunger'],
      ["9781784295547", 'Shrill'],
      ["9780807083109", 'Kindred'],
    ]);

    const bookQuery = gql`
      query {
        book(isbn: $isbn) {
          isbn
          title
          favorited @client
        }
      }
    `;

    const shrillResult = cache.readQuery({
      query: bookQuery,
      variables: {
        isbn: "9781784295547"
      }
    });

    expect(shrillResult).toEqual({book: {
      __typename: "Book",
      isbn: "9781784295547",
      title: "Shrill",
      favorited: true,
    }});

    const kindredResult = cache.readQuery({
      query: bookQuery,
      variables: {
        isbn: "9780807083109"
      }
    });

    expect(kindredResult).toEqual({book: {
      __typename: "Book",
      isbn: "9780807083109",
      title: "Kindred",
      favorited: false,
    }});
  });

  it("should not over-invalidate fields with keyArgs", () => {
    const isbnsWeHaveRead: string[] = [];

    const cache = new InMemoryCache({
      typePolicies: {
        Query: {
          fields: {
            book: {
              // The presence of this keyArgs configuration permits the
              // cache to track result caching dependencies at the level
              // of individual Books, so writing one Book does not
              // invalidate other Books with different ISBNs. If the cache
              // doesn't know which arguments are "important," it can't
              // make any assumptions about the relationships between
              // field values with the same field name but different
              // arguments, so it has to err on the side of invalidating
              // all Query.book data whenever any Book is written.
              keyArgs: ["isbn"],

              read(book, { args, toReference }) {
                isbnsWeHaveRead.push(args!.isbn);
                return book || toReference({
                  __typename: "Book",
                  isbn: args!.isbn,
                });
              },
            },
          },
        },

        Book: {
          keyFields: ["isbn"],
        },
      },
    });

    const query = gql`
      query Book($isbn: string) {
        book(isbn: $isbn) {
          title
          isbn
          author {
            name
          }
        }
      }
    `;

    const diffs: Cache.DiffResult<any>[] = [];
    cache.watch({
      query,
      optimistic: true,
      variables: {
        isbn: "1449373321",
      },
      callback(diff) {
        diffs.push(diff);
      },
    });

    const ddiaData = {
      book: {
        __typename: "Book",
        isbn: "1449373321",
        title: "Designing Data-Intensive Applications",
        author: {
          __typename: "Author",
          name: "Martin Kleppmann",
        },
      },
    };

    expect(isbnsWeHaveRead).toEqual([]);

    cache.writeQuery({
      query,
      variables: {
        isbn: "1449373321",
      },
      data: ddiaData,
    });

    expect(isbnsWeHaveRead).toEqual([
      "1449373321",
    ]);

    expect(diffs).toEqual([
      {
        complete: true,
        result: ddiaData,
      },
    ]);

    const theEndData = {
      book: {
        __typename: "Book",
        isbn: "1982103558",
        title: "The End of Everything",
        author: {
          __typename: "Author",
          name: "Katie Mack",
        },
      },
    };

    cache.writeQuery({
      query,
      variables: {
        isbn: "1982103558",
      },
      data: theEndData,
    });

    // This list does not include the book we just wrote, because the
    // cache.watch we started above only depends on the Query.book field
    // value corresponding to the 1449373321 ISBN.
    expect(diffs).toEqual([
      {
        complete: true,
        result: ddiaData,
      },
    ]);

    // Likewise, this list is unchanged, because we did not need to read
    // the 1449373321 Book again after writing the 1982103558 data.
    expect(isbnsWeHaveRead).toEqual([
      "1449373321",
    ]);

    const theEndResult = cache.readQuery({
      query,
      variables: {
        isbn: "1982103558",
      },
      // TODO It's a regrettable accident of history that cache.readQuery is
      // non-optimistic by default. Perhaps the default can be swapped to true
      // in the next major version of Apollo Client.
      optimistic: true,
    });

    expect(theEndResult).toEqual(theEndData);

    expect(isbnsWeHaveRead).toEqual([
      "1449373321",
      "1982103558",
    ]);

    expect(cache.readQuery({
      query,
      variables: {
        isbn: "1449373321",
      },
      optimistic: true,
    })).toBe(diffs[0].result);

    expect(cache.readQuery({
      query,
      variables: {
        isbn: "1982103558",
      },
      optimistic: true,
    })).toBe(theEndResult);

    // Still no additional reads, because both books are cached.
    expect(isbnsWeHaveRead).toEqual([
      "1449373321",
      "1982103558",
    ]);

    // Evicting the 1982103558 Book should not invalidate the 1449373321
    // Book, so diffs and isbnsWeHaveRead should remain unchanged.
    expect(cache.evict({
      id: cache.identify({
        __typename: "Book",
        isbn: "1982103558",
      }),
    })).toBe(true);

    expect(diffs).toEqual([
      {
        complete: true,
        result: ddiaData,
      },
    ]);

    expect(isbnsWeHaveRead).toEqual([
      "1449373321",
      "1982103558",
    ]);

    expect(cache.readQuery({
      query,
      variables: {
        isbn: "1449373321",
      },
      // Read this query non-optimistically, to test that the read function
      // runs again, adding "1449373321" again to isbnsWeHaveRead.
      optimistic: false,
    })).toBe(diffs[0].result);

    expect(isbnsWeHaveRead).toEqual([
      "1449373321",
      "1982103558",
      "1449373321",
    ]);
  });
});
