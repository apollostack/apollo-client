import gql from "graphql-tag";

import { InMemoryCache } from "../inMemoryCache";
import { ReactiveVar, makeVar } from "../reactiveVars";
import { Reference, StoreObject, ApolloClient, NetworkStatus, TypedDocumentNode, DocumentNode } from "../../../core";
import { MissingFieldError } from "../..";
import { relayStylePagination } from "../../../utilities";
import { MockLink } from '../../../utilities/testing/mocking/mockLink';
import subscribeAndCount from '../../../utilities/testing/subscribeAndCount';
import { itAsync } from '../../../utilities/testing/itAsync';
import { FieldPolicy, StorageType } from "../policies";
import { withErrorSpy } from "../../../testing";

function reverse(s: string) {
  return s.split("").reverse().join("");
}

describe("type policies", function () {
  const bookQuery = gql`
    query {
      book {
        title
        author {
          name
        }
      }
    }
  `;

  const theInformationBookData = {
    __typename: "Book",
    isbn: "1400096235",
    title: "The Information",
    subtitle: "A History, a Theory, a Flood",
    author: {
      name: "James Gleick"
    },
  };

  function checkAuthorName(cache: InMemoryCache) {
    expect(cache.readQuery({
      query: gql`
        query {
          book {
            author {
              name
            }
          }
        }
      `,
    })).toEqual({
      book: {
        __typename: "Book",
        author: {
          name: theInformationBookData.author.name,
        },
      },
    });
  }

  it("can specify basic keyFields", function () {
    const cache = new InMemoryCache({
      typePolicies: {
        Book: {
          keyFields: ["isbn"],
        },
      },
    });

    cache.writeQuery({
      query: bookQuery,
      data: {
        book: theInformationBookData,
      },
    });

    expect(cache.extract(true)).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        book: {
          __ref: 'Book:{"isbn":"1400096235"}',
        },
      },
      'Book:{"isbn":"1400096235"}': {
        __typename: "Book",
        isbn: "1400096235",
        title: "The Information",
        author: {
          name: "James Gleick"
        },
      },
    });

    checkAuthorName(cache);
  });

  it("can specify composite keyFields", function () {
    const cache = new InMemoryCache({
      typePolicies: {
        Book: {
          keyFields: ["title", "author", ["name"]],
        },
      },
    });

    cache.writeQuery({
      query: bookQuery,
      data: {
        book: theInformationBookData,
      },
    });

    expect(cache.extract(true)).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        book: {
          __ref: 'Book:{"title":"The Information","author":{"name":"James Gleick"}}',
        },
      },
      'Book:{"title":"The Information","author":{"name":"James Gleick"}}': {
        __typename: "Book",
        title: "The Information",
        author: {
          name: "James Gleick"
        },
      },
    });

    checkAuthorName(cache);
  });

  it("keeps keyFields in specified order", function () {
    const cache = new InMemoryCache({
      typePolicies: {
        Book: {
          keyFields: ["author", ["name"], "title"],
        },
      },
    });

    cache.writeQuery({
      query: bookQuery,
      data: {
        book: theInformationBookData,
      },
    });

    expect(cache.extract(true)).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        book: {
          __ref: 'Book:{"author":{"name":"James Gleick"},"title":"The Information"}',
        },
      },
      'Book:{"author":{"name":"James Gleick"},"title":"The Information"}': {
        __typename: "Book",
        title: "The Information",
        author: {
          name: "James Gleick"
        },
      },
    });

    checkAuthorName(cache);
  });

  it("accepts keyFields functions", function () {
    const cache = new InMemoryCache({
      typePolicies: {
        Book: {
          keyFields(book, context) {
            expect(context.typename).toBe("Book");
            expect(context.selectionSet!.kind).toBe("SelectionSet");
            expect(context.fragmentMap).toEqual({});
            return ["isbn"];
          },
        },
      },
    });

    cache.writeQuery({
      query: bookQuery,
      data: {
        book: theInformationBookData,
      },
    });

    expect(cache.extract(true)).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        book: {
          __ref: 'Book:{"isbn":"1400096235"}',
        },
      },
      'Book:{"isbn":"1400096235"}': {
        __typename: "Book",
        isbn: "1400096235",
        title: "The Information",
        author: {
          name: "James Gleick"
        },
      },
    });

    checkAuthorName(cache);
  });

  it("works with fragments that contain aliased key fields", function () {
    const cache = new InMemoryCache({
      typePolicies: {
        Book: {
          keyFields: ["ISBN", "title"],
        },
      },
    });

    cache.writeQuery({
      query: gql`
        query {
          book {
            ...BookFragment
            author {
              name
            }
          }
        }
        fragment BookFragment on Book {
          isbn: ISBN
          title
        }
      `,
      data: {
        book: theInformationBookData,
      },
    });

    expect(cache.extract(true)).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        book: {
          __ref: 'Book:{"ISBN":"1400096235","title":"The Information"}',
        },
      },
      'Book:{"ISBN":"1400096235","title":"The Information"}': {
        __typename: "Book",
        ISBN: "1400096235",
        title: "The Information",
        author: {
          name: "James Gleick"
        },
      },
    });

    checkAuthorName(cache);
  });

  withErrorSpy(it, "complains about missing key fields", function () {
    const cache = new InMemoryCache({
      typePolicies: {
        Book: {
          keyFields: ["title", "year"],
        },
      },
    });

    const query = gql`
      query {
        book {
          title
          year
        }
      }
    `;

    cache.writeQuery({
      query,
      data: {
        book: {
          year: 2011,
          theInformationBookData,
        },
      },
    });

    expect(() => {
      cache.writeQuery({
        query,
        data: {
          book: theInformationBookData,
        },
      });
    }).toThrowError("Missing field 'year' while computing key fields");
  });

  it("does not clobber previous keyFields with undefined", function () {
    const cache = new InMemoryCache({
      typePolicies: {
        Movie: {
          keyFields(incoming) {
            return `MotionPicture::${incoming.id}`;
          },
        },
      },
    });

    cache.policies.addTypePolicies({
      Movie: {
        fields: {
          isPurchased() {
            return false;
          },
        },
      },
    });

    expect(cache.identify({
      __typename: "Movie",
      id: "3993d4118143",
    })).toBe("MotionPicture::3993d4118143");
  });

  it("does not remove previous typePolicies", function () {
    const cache = new InMemoryCache({
      typePolicies: {
        Query: {
          fields: {
            foo: () => 'foo'
          }
        },
      },
    });

    cache.policies.addTypePolicies({
      Query: {
        fields: {
          bar: () => 'bar'
        }
      },
    });

    expect(cache.readQuery({ query: gql` { foo } ` })).toEqual({foo: "foo"});
    expect(cache.readQuery({ query: gql` { bar } ` })).toEqual({bar: "bar"});
  });

  it("support inheritance", function () {
    const cache = new InMemoryCache({
      possibleTypes: {
        Reptile: ["Snake", "Turtle"],
        Snake: ["Python", "Viper", "Cobra"],
        Viper: ["Cottonmouth"],
      },

      typePolicies: {
        Reptile: {
          keyFields: ["tagId"],

          fields: {
            scientificName: {
              merge(_, incoming) {
                // Normalize all scientific names to lower case.
                return incoming.toLowerCase();
              },
            },
          },
        },

        Snake: {
          fields: {
            // Default to a truthy non-boolean value if we don't know
            // whether this snake is venomous.
            venomous(status = "unknown") {
              return status;
            },
          },
        },
      },
    });

    const query: TypedDocumentNode<{
      reptiles: Record<string, any>[];
    }> = gql`
      query {
        reptiles {
          tagId
          scientificName
          ... on Snake {
            venomous
          }
        }
      }
    `;

    const reptiles = [
      {
        __typename: "Turtle",
        tagId: "RedEaredSlider42",
        scientificName: "Trachemys scripta elegans",
      },
      {
        __typename: "Python",
        tagId: "BigHug4U",
        scientificName: "Malayopython reticulatus",
        venomous: false,
      },
      {
        __typename: "Cobra",
        tagId: "Egypt30BC",
        scientificName: "Naja haje",
        venomous: true,
      },
      {
        __typename: "Cottonmouth",
        tagId: "CM420",
        scientificName: "Agkistrodon piscivorus",
        venomous: true,
      },
    ];

    cache.writeQuery({
      query,
      data: { reptiles },
    });

    expect(cache.extract()).toMatchSnapshot();

    const result1 = cache.readQuery({ query })!;
    expect(result1).toEqual({
      reptiles: reptiles.map(reptile => ({
        ...reptile,
        scientificName: reptile.scientificName.toLowerCase(),
      })),
    });

    const cmId = cache.identify({
      __typename: "Cottonmouth",
      tagId: "CM420",
    });

    expect(cache.evict({
      id: cmId,
      fieldName: "venomous",
    })).toBe(true);

    const result2 = cache.readQuery({ query })!;

    result2.reptiles.forEach((reptile, i) => {
      if (reptile.__typename === "Cottonmouth") {
        expect(reptile).not.toBe(result1.reptiles[i]);
        expect(reptile).not.toEqual(result1.reptiles[i]);
        expect(reptile).toEqual({
          __typename: "Cottonmouth",
          tagId: "CM420",
          // This name has been normalized to lower case.
          scientificName: "agkistrodon piscivorus",
          // Venomosity status has been set to a default value.
          venomous: "unknown",
        });
      } else {
        expect(reptile).toBe(result1.reptiles[i]);
      }
    });

    cache.policies.addPossibleTypes({
      Viper: ["DeathAdder"],
    });

    expect(cache.identify({
      __typename: "DeathAdder",
      tagId: "LethalAbacus666",
    })).toBe('DeathAdder:{"tagId":"LethalAbacus666"}');
  });

  describe("field policies", function () {
    it("can filter key arguments", function () {
      const cache = new InMemoryCache({
        typePolicies: {
          Query: {
            fields: {
              book: {
                keyArgs: ["isbn"],
              },
            },
          },
        },
      });

      cache.writeQuery({
        query: gql`
          query {
            book(junk: "ignored", isbn: "0465030793") {
              title
            }
          }
        `,
        data: {
          book: {
            __typename: "Book",
            isbn: "0465030793",
            title: "I Am a Strange Loop",
          },
        },
      });

      expect(cache.extract(true)).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          'book:{"isbn":"0465030793"}': {
            __typename: "Book",
            title: "I Am a Strange Loop",
          },
        },
      });
    });

    it("can filter key arguments in non-Query fields", function () {
      const cache = new InMemoryCache({
        typePolicies: {
          Book: {
            keyFields: ["isbn"],
            fields: {
              author: {
                keyArgs: ["firstName", "lastName"],
              },
            },
          },
          Author: {
            keyFields: ["name"],
          },
        },
      });

      const query = gql`
        query {
          book {
            isbn
            title
            author(
              firstName: "Douglas",
              middleName: "Richard",
              lastName: "Hofstadter"
            ) {
              name
            }
          }
        }
      `;

      const data = {
        book: {
          __typename: "Book",
          isbn: "0465030793",
          title: "I Am a Strange Loop",
          author: {
            __typename: "Author",
            name: "Douglas Hofstadter",
          },
        },
      };

      cache.writeQuery({ query, data });

      expect(cache.extract(true)).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          book: {
            __ref: 'Book:{"isbn":"0465030793"}',
          },
        },
        'Book:{"isbn":"0465030793"}': {
          __typename: "Book",
          isbn: "0465030793",
          title: "I Am a Strange Loop",
          'author:{"firstName":"Douglas","lastName":"Hofstadter"}': {
            __ref: 'Author:{"name":"Douglas Hofstadter"}',
          },
        },
        'Author:{"name":"Douglas Hofstadter"}': {
          __typename: "Author",
          name: "Douglas Hofstadter",
        },
      });

      const result = cache.readQuery({ query });
      expect(result).toEqual(data);
    });

    withErrorSpy(it, "assumes keyArgs:false when read and merge function present", function () {
      const cache = new InMemoryCache({
        typePolicies: {
          TypeA: {
            fields: {
              a() {
                return "a";
              },
            },
          },

          TypeB: {
            fields: {
              b: {
                keyArgs: ["x"],
                read() {
                  return "b";
                },
              },
            },
          },

          TypeC: {
            fields: {
              c: {
                keyArgs: false,
                merge(existing, incoming: string) {
                  return reverse(incoming);
                },
              },
            },
          },

          TypeD: {
            fields: {
              d: {
                keyArgs() {
                  return "d";
                },
                read(existing: string) {
                  return existing.toLowerCase();
                },
                merge(existing: string, incoming: string) {
                  return incoming.toUpperCase();
                },
              },
            },
          },

          TypeE: {
            fields: {
              e: {
                read(existing: string) {
                  return existing.slice(1);
                },
                merge(existing: string, incoming: string) {
                  return "*" + incoming;
                },
              },
            },
          },

          TypeF: {
            fields: {
              f: {
                // nothing
              },
            },
          },

          Query: {
            fields: {
              types(existing: any[], { args }) {
                const fromCode = args!.from.charCodeAt(0);
                const toCode = args!.to.charCodeAt(0);
                let e = 0;
                for (let code = fromCode; code <= toCode; ++code) {
                  const upper = String.fromCharCode(code).toUpperCase();
                  const obj = existing[e++];
                  expect(obj.__typename).toBe("Type" + upper);
                }
                return existing;
              },
            },
          },
        },
      });

      const query = gql`
        query {
          types(from: "A", to: "F") {
            ... on TypeA { a }
            ... on TypeB { b(x: 1, y: 2, z: 3) }
            ... on TypeC { c(see: "si") }
            ... on TypeD { d }
            ... on TypeE { e(eee: "ee") }
            ... on TypeF { f(g: "h") }
          }
        }
      `;

      cache.writeQuery({
        query,
        data: {
          types: [{
            __typename: "TypeA",
          }, {
            __typename: "TypeB",
            b: "x1",
          }, {
            __typename: "TypeC",
            c: "naive",
          }, {
            __typename: "TypeD",
            d: "quiet",
          }, {
            __typename: "TypeE",
            e: "asterisk",
          }, {
            __typename: "TypeF",
            f: "effigy",
          }],
        },
      });

      expect(cache.extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          'types({"from":"A","to":"F"})': [
            {
              __typename: "TypeA",
            },
            {
              __typename: "TypeB",
              'b:{"x":1}': "x1",
            },
            {
              __typename: "TypeC",
              c: "evian",
            },
            {
              __typename: "TypeD",
              d: "QUIET",
            },
            {
              __typename: "TypeE",
              e: "*asterisk",
            },
            {
              __typename: "TypeF",
              'f({"g":"h"})': "effigy",
            },
          ],
        },
      });

      const result = cache.readQuery({ query });
      expect(result).toEqual({
        types: [
          {
            __typename: "TypeA",
            a: "a",
          }, {
            __typename: "TypeB",
            b: "b",
          }, {
            __typename: "TypeC",
            c: "evian",
          }, {
            __typename: "TypeD",
            d: "quiet",
          }, {
            __typename: "TypeE",
            e: "asterisk",
          }, {
            __typename: "TypeF",
            f: "effigy",
          }
        ],
      });
    });

    it("can include optional arguments in keyArgs", function () {
      const cache = new InMemoryCache({
        typePolicies: {
          Author: {
            keyFields: ["name"],
            fields: {
              writings: {
                keyArgs: ["a", "b", "type"]
              },
            },
          },
        },
      });

      const data = {
        author: {
          __typename: "Author",
          name: "Nadia Eghbal",
          writings: [{
            __typename: "Book",
            isbn: "0578675862",
            title: "Working in Public: The Making and Maintenance of " +
              "Open Source Software",
          }],
        },
      };

      function check<TData extends typeof data, TVars>(
        query: DocumentNode | TypedDocumentNode<TData, TVars>,
        variables?: TVars,
      ) {
        cache.writeQuery({ query, variables, data });
        expect(cache.readQuery({ query, variables })).toEqual(data);
      }

      check(gql`
        query {
          author {
            name
            writings(type: "Book") {
              ... on Book {
                title
                isbn
              }
            }
          }
        }
      `);
      expect(cache.extract()).toMatchSnapshot();

      check(gql`
        query {
          author {
            name
            writings(type: "Book", b: 2, a: 1) {
              ... on Book {
                title
                isbn
              }
            }
          }
        }
      `);
      expect(cache.extract()).toMatchSnapshot();

      check(gql`
        query {
          author {
            name
            writings(b: 2, a: 1) {
              ... on Book {
                title
                isbn
              }
            }
          }
        }
      `);
      expect(cache.extract()).toMatchSnapshot();

      check(gql`
        query {
          author {
            name
            writings(b: 2) {
              ... on Book {
                title
                isbn
              }
            }
          }
        }
      `);
      expect(cache.extract()).toMatchSnapshot();

      check(gql`
        query {
          author {
            name
            writings(a: 3) {
              ... on Book {
                title
                isbn
              }
            }
          }
        }
      `);
      expect(cache.extract()).toMatchSnapshot();

      check(gql`
        query {
          author {
            name
            writings(unrelated: "oyez") {
              ... on Book {
                title
                isbn
              }
            }
          }
        }
      `);
      expect(cache.extract()).toMatchSnapshot();

      check(gql`
        query AuthorWritings ($type: String) {
          author {
            name
            writings(b: 4, type: $type, unrelated: "oyez") {
              ... on Book {
                title
                isbn
              }
            }
          }
        }
      `, { type: void 0 as any });
      expect(cache.extract()).toMatchSnapshot();

      check(gql`
        query {
          author {
            name
            writings {
              ... on Book {
                title
                isbn
              }
            }
          }
        }
      `);
      expect(cache.extract()).toMatchSnapshot();

      const storeFieldNames: string[] = [];

      cache.modify({
        id: cache.identify({
          __typename: "Author",
          name: "Nadia Eghbal",
        }),

        fields: {
          writings(value, { storeFieldName }) {
            storeFieldNames.push(storeFieldName);
            expect(value).toEqual(data.author.writings);
            return value;
          },
        },
      })

      expect(storeFieldNames.sort()).toEqual([
        "writings",
        'writings:{"a":1,"b":2,"type":"Book"}',
        'writings:{"a":1,"b":2}',
        'writings:{"a":3}',
        'writings:{"b":2}',
        'writings:{"b":4}',
        'writings:{"type":"Book"}',
        "writings:{}",
      ]);
    });

    it("can return KeySpecifier arrays from keyArgs functions", function () {
      const cache = new InMemoryCache({
        typePolicies: {
          Thread: {
            keyFields: ["tid"],
            fields: {
              comments: {
                keyArgs(args, context) {
                  expect(context.typename).toBe("Thread");
                  expect(context.fieldName).toBe("comments");
                  expect(context.field!.name.value).toBe("comments");
                  expect(context.variables).toEqual({
                    unused: "check me",
                  });

                  if (typeof args!.limit === "number") {
                    if (typeof args!.offset === "number") {
                      expect(args).toEqual({ offset: 0, limit: 2 });
                      return ["offset", "limit"];
                    }
                    if (args!.beforeId) {
                      expect(args).toEqual({ beforeId: "asdf", limit: 2 });
                      return ["beforeId", "limit"];
                    }
                  }
                },
              },
            },
          },

          Comment: {
            keyFields: ["author", ["name"]],
          },
        },
      });

      const query = gql`
        query {
          thread {
            tid
            offsetComments: comments(offset: 0, limit: 2) {
              author { name }
            }
            beforeIdComments: comments(beforeId: "asdf", limit: 2) {
              author { name }
            }
          }
        }
      `;

      cache.writeQuery({
        query,
        data: {
          thread: {
            __typename: "Thread",
            tid: "12345",
            offsetComments: [{
              __typename: "Comment",
              author: { name: "Alice" },
            }, {
              __typename: "Comment",
              author: { name: "Bobby" },
            }],
            beforeIdComments: [{
              __typename: "Comment",
              author: { name: "Calvin" },
            }, {
              __typename: "Comment",
              author: { name: "Hobbes" },
            }],
          },
        },
        variables: {
          unused: "check me",
        },
      });

      expect(cache.extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          thread: {
            __ref: 'Thread:{"tid":"12345"}',
          },
        },
        'Thread:{"tid":"12345"}': {
          __typename: "Thread",
          tid: "12345",
          'comments:{"beforeId":"asdf","limit":2}': [
            { __ref: 'Comment:{"author":{"name":"Calvin"}}' },
            { __ref: 'Comment:{"author":{"name":"Hobbes"}}' },
          ],
          'comments:{"offset":0,"limit":2}': [
            { __ref: 'Comment:{"author":{"name":"Alice"}}' },
            { __ref: 'Comment:{"author":{"name":"Bobby"}}' },
          ],
        },
        'Comment:{"author":{"name":"Alice"}}': {
          __typename: "Comment",
          author: {
            name: "Alice",
          },
        },
        'Comment:{"author":{"name":"Bobby"}}': {
          __typename: "Comment",
          author: {
            name: "Bobby",
          },
        },
        'Comment:{"author":{"name":"Calvin"}}': {
          __typename: "Comment",
          author: {
            name: "Calvin",
          },
        },
        'Comment:{"author":{"name":"Hobbes"}}': {
          __typename: "Comment",
          author: {
            name: "Hobbes",
          },
        },
      });
    });

    it("can use options.storage in read functions", function () {
      const storageSet = new Set<Record<string, any>>();

      const cache = new InMemoryCache({
        typePolicies: {
          Task: {
            fields: {
              result(existing, { args, storage }) {
                storageSet.add(storage);
                if (storage.result) return storage.result;
                return storage.result = compute();
              },
            },
          },
        },
      });

      let computeCount = 0;
      function compute() {
        return `expensive result ${++computeCount}`;
      }

      cache.writeQuery({
        query: gql`
          query {
            tasks {
              id
            }
          }
        `,
        data: {
          tasks: [{
            __typename: "Task",
            id: 1,
          }, {
            __typename: "Task",
            id: 2,
          }],
        },
      });

      expect(cache.extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          tasks: [
            { __ref: "Task:1" },
            { __ref: "Task:2" },
          ],
        },
        "Task:1": {
          __typename: "Task",
          id: 1,
        },
        "Task:2": {
          __typename: "Task",
          id: 2,
        },
      });

      const result1 = cache.readQuery({
        query: gql`
          query {
            tasks {
              result
            }
          }
        `,
      });

      expect(result1).toEqual({
        tasks: [{
          __typename: "Task",
          result: "expensive result 1",
        }, {
          __typename: "Task",
          result: "expensive result 2",
        }],
      });

      const result2 = cache.readQuery({
        query: gql`
          query {
            tasks {
              id
              result
            }
          }
        `,
      });

      expect(result2).toEqual({
        tasks: [{
          __typename: "Task",
          id: 1,
          result: "expensive result 1",
        }, {
          __typename: "Task",
          id: 2,
          result: "expensive result 2",
        }],
      });

      // Clear the cached results.
      storageSet.forEach(storage => {
        delete storage.result;
      });

      const result3 = cache.readQuery({
        query: gql`
          query {
            tasks {
              __typename
              result
            }
          }
        `,
      });

      expect(result3).toEqual({
        tasks: [{
          __typename: "Task",
          result: "expensive result 3",
        }, {
          __typename: "Task",
          result: "expensive result 4",
        }],
      });
    });

    it("can use read function to implement synthetic/computed keys", function () {
      const cache = new InMemoryCache({
        typePolicies: {
          Person: {
            keyFields: ["firstName", "lastName"],
            fields: {
              fullName(_, { readField }) {
                const firstName = readField("firstName");
                const lastName = readField("lastName");
                return `${firstName} ${lastName}`;
              },
            },
          },
        },
      });

      cache.writeQuery({
        query: gql`
          query {
            me {
              firstName
              lastName
            }
          }
        `,
        data: {
          me: {
            __typename: "Person",
            firstName: "Ben",
            lastName: "Newman",
          },
        },
      });

      const expectedExtraction = {
        ROOT_QUERY: {
          __typename: "Query",
          me: {
            __ref: 'Person:{"firstName":"Ben","lastName":"Newman"}',
          },
        },
        'Person:{"firstName":"Ben","lastName":"Newman"}': {
          __typename: "Person",
          firstName: "Ben",
          lastName: "Newman",
        },
      };

      expect(cache.extract(true)).toEqual(expectedExtraction);

      const expectedResult = {
        me: {
          __typename: "Person",
          fullName: "Ben Newman",
        },
      };

      expect(cache.readQuery({
        query: gql`
          query {
            me {
              fullName
            }
          }
        `,
      })).toEqual(expectedResult);

      expect(cache.readQuery({
        query: gql`
          query {
            me {
              fullName @client
            }
          }
        `,
      })).toEqual(expectedResult);

      expect(cache.extract(true)).toEqual(expectedExtraction);
    });

    withErrorSpy(it, "read and merge can cooperate through options.storage", function () {
      const cache = new InMemoryCache({
        typePolicies: {
          Query: {
            fields: {
              jobs: {
                merge(existing: any[] = [], incoming: any[]) {
                  return [...existing, ...incoming];
                },
              },
            },
          },

          Job: {
            keyFields: ["name"],
            fields: {
              result: {
                read(_, { storage }) {
                  if (!storage.jobName) {
                    storage.jobName = makeVar(undefined);
                  }
                  return storage.jobName();
                },
                merge(_, incoming: string, { storage }) {
                  if (storage.jobName) {
                    storage.jobName(incoming);
                  } else {
                    storage.jobName = makeVar(incoming);
                  }
                },
              },
            },
          },
        },
      });

      const query = gql`
        query {
          jobs {
            name
            result
          }
        }
      `;

      cache.writeQuery({
        query,
        data: {
          jobs: [{
            __typename: "Job",
            name: "Job #1",
            // intentionally omitting the result field
          }, {
            __typename: "Job",
            name: "Job #2",
            // intentionally omitting the result field
          }, {
            __typename: "Job",
            name: "Job #3",
            // intentionally omitting the result field
          }],
        },
      });

      const snapshot1 = {
        ROOT_QUERY: {
          __typename: "Query",
          jobs: [
            { __ref: 'Job:{"name":"Job #1"}' },
            { __ref: 'Job:{"name":"Job #2"}' },
            { __ref: 'Job:{"name":"Job #3"}' },
          ],
        },
        'Job:{"name":"Job #1"}': {
          __typename: "Job",
          name: "Job #1",
        },
        'Job:{"name":"Job #2"}': {
          __typename: "Job",
          name: "Job #2",
        },
        'Job:{"name":"Job #3"}': {
          __typename: "Job",
          name: "Job #3",
        },
      };

      expect(cache.extract()).toEqual(snapshot1);

      function makeMissingError(jobNumber: number) {
        return new MissingFieldError(
          `Can't find field 'result' on Job:{"name":"Job #${jobNumber}"} object`,
          ["jobs", jobNumber - 1, "result"],
          expect.anything(), // query
          expect.anything(), // variables
        );
      }

      expect(cache.diff({
        query,
        optimistic: false,
        returnPartialData: true,
      })).toEqual({
        result: {
          jobs: [{
            __typename: "Job",
            name: "Job #1",
          }, {
            __typename: "Job",
            name: "Job #2",
          }, {
            __typename: "Job",
            name: "Job #3",
          }],
        },
        complete: false,
        missing: [
          makeMissingError(1),
          makeMissingError(2),
          makeMissingError(3),
        ],
      });

      function setResult(jobNum: number) {
        cache.writeFragment({
          id: cache.identify({
            __typename: "Job",
            name: `Job #${jobNum}`,
          })!,
          fragment: gql`
            fragment JobResult on Job {
              result
            }
          `,
          data: {
            __typename: "Job",
            name: `Job #${jobNum}`,
            result: `result for job ${jobNum}`,
          },
        });
      }

      setResult(2);

      // Nothing should have changed in the cache itself as a result of
      // writing a result for job #2.
      expect(cache.extract()).toEqual({
        ...snapshot1,
        __META: {
          extraRootIds: [
            'Job:{"name":"Job #2"}',
          ],
        },
      });

      expect(cache.diff({
        query,
        optimistic: false,
        returnPartialData: true,
      })).toEqual({
        result: {
          jobs: [{
            __typename: "Job",
            name: "Job #1",
          }, {
            __typename: "Job",
            name: "Job #2",
            result: "result for job 2",
          }, {
            __typename: "Job",
            name: "Job #3",
          }],
        },
        complete: false,
        missing: [
          makeMissingError(1),
          makeMissingError(3),
        ],
      });

      cache.writeQuery({
        query,
        data: {
          jobs: [{
            __typename: "Job",
            name: "Job #4",
            result: "result for job 4",
          }],
        },
      });

      const snapshot2 = {
        ...snapshot1,
        ROOT_QUERY: {
          ...snapshot1.ROOT_QUERY,
          jobs: [
            ...snapshot1.ROOT_QUERY.jobs,
            { __ref: 'Job:{"name":"Job #4"}' },
          ],
        },
        'Job:{"name":"Job #4"}': {
          __typename: "Job",
          name: "Job #4",
        },
      };

      expect(cache.extract()).toEqual({
        ...snapshot2,
        __META: {
          extraRootIds: [
            'Job:{"name":"Job #2"}',
          ],
        },
      });

      expect(cache.diff({
        query,
        optimistic: false,
        returnPartialData: true,
      })).toEqual({
        result: {
          jobs: [{
            __typename: "Job",
            name: "Job #1",
          }, {
            __typename: "Job",
            name: "Job #2",
            result: "result for job 2",
          }, {
            __typename: "Job",
            name: "Job #3",
          }, {
            __typename: "Job",
            name: "Job #4",
            result: "result for job 4",
          }],
        },
        complete: false,
        missing: [
          makeMissingError(1),
          makeMissingError(3),
        ],
      });

      setResult(1);
      setResult(3);

      expect(cache.diff({
        query,
        optimistic: false,
        returnPartialData: true,
      })).toEqual({
        result: {
          jobs: [{
            __typename: "Job",
            name: "Job #1",
            result: "result for job 1",
          }, {
            __typename: "Job",
            name: "Job #2",
            result: "result for job 2",
          }, {
            __typename: "Job",
            name: "Job #3",
            result: "result for job 3",
          }, {
            __typename: "Job",
            name: "Job #4",
            result: "result for job 4",
          }],
        },
        complete: true,
      });

      expect(cache.readQuery({ query })).toEqual({
        jobs: [{
          __typename: "Job",
          name: "Job #1",
          result: "result for job 1",
        }, {
          __typename: "Job",
          name: "Job #2",
          result: "result for job 2",
        }, {
          __typename: "Job",
          name: "Job #3",
          result: "result for job 3",
        }, {
          __typename: "Job",
          name: "Job #4",
          result: "result for job 4",
        }],
      });
    });

    it("read, merge, and modify functions can access options.storage", function () {
      const storageByFieldName = new Map<string, StorageType>();

      function recordStorageOnce(fieldName: string, storage: StorageType) {
        if (storageByFieldName.has(fieldName)) {
          expect(storageByFieldName.get(fieldName)).toBe(storage);
        } else {
          storageByFieldName.set(fieldName, storage);
        }
      }

      function makeFieldPolicy(): FieldPolicy<number> {
        return {
          read(existing = 0, { fieldName, storage }) {
            storage.readCount = (storage.readCount|0) + 1;
            recordStorageOnce(fieldName, storage);
            return existing;
          },
          merge(existing = 0, incoming, { fieldName, storage }) {
            storage.mergeCount = (storage.mergeCount|0) + 1;
            recordStorageOnce(fieldName, storage);
            return existing + incoming;
          },
        };
      };

      const cache = new InMemoryCache({
        typePolicies: {
          Query: {
            fields: {
              mergeRead: makeFieldPolicy(),
              mergeModify: makeFieldPolicy(),
              mergeReadModify: makeFieldPolicy(),
            },
          },
        },
      });

      const query: TypedDocumentNode<{
        mergeRead: number;
        mergeModify: number;
        mergeReadModify: number;
      }> = gql`
        query {
          mergeRead
          mergeModify
          mergeReadModify
        }
      `;

      cache.writeQuery({
        query,
        data: {
          mergeRead: 1,
          mergeModify: 10,
          mergeReadModify: 100,
        },
      });

      expect(storageByFieldName.get("mergeRead")).toEqual({
        mergeCount: 1,
      });

      expect(storageByFieldName.get("mergeModify")).toEqual({
        mergeCount: 1,
      });

      expect(storageByFieldName.get("mergeReadModify")).toEqual({
        mergeCount: 1,
      });

      expect(cache.readQuery({
        query: gql`query { mergeRead mergeReadModify }`,
      })).toEqual({
        mergeRead: 1,
        mergeReadModify: 100,
      });

      expect(storageByFieldName.get("mergeRead")).toEqual({
        mergeCount: 1,
        readCount: 1,
      });

      expect(storageByFieldName.get("mergeModify")).toEqual({
        mergeCount: 1,
      });

      expect(storageByFieldName.get("mergeReadModify")).toEqual({
        mergeCount: 1,
        readCount: 1,
      });

      expect(cache.modify({
        fields: {
          mergeModify(value, { fieldName, storage }) {
            storage.modifyCount = (storage.modifyCount|0) + 1;
            recordStorageOnce(fieldName, storage);
            return value + 1;
          },
          mergeReadModify(value, { fieldName, storage }) {
            storage.modifyCount = (storage.modifyCount|0) + 1;
            recordStorageOnce(fieldName, storage);
            return value + 1;
          },
        },
      })).toBe(true);

      expect(cache.extract()).toMatchSnapshot();

      expect(storageByFieldName.get("mergeRead")).toEqual({
        mergeCount: 1,
        readCount: 1,
      });

      expect(storageByFieldName.get("mergeModify")).toEqual({
        mergeCount: 1,
        modifyCount: 1,
      });

      expect(storageByFieldName.get("mergeReadModify")).toEqual({
        mergeCount: 1,
        readCount: 1,
        modifyCount: 1,
      });

      expect(cache.readQuery({ query })).toEqual({
        mergeRead: 1,
        mergeModify: 11,
        mergeReadModify: 101,
      });

      expect(storageByFieldName.get("mergeRead")).toEqual({
        mergeCount: 1,
        readCount: 2,
      });

      expect(storageByFieldName.get("mergeModify")).toEqual({
        mergeCount: 1,
        modifyCount: 1,
        readCount: 1,
      });

      expect(storageByFieldName.get("mergeReadModify")).toEqual({
        mergeCount: 1,
        readCount: 2,
        modifyCount: 1,
      });

      expect(cache.extract()).toMatchSnapshot();
    });

    it("merge functions can deduplicate items using readField", function () {
      const cache = new InMemoryCache({
        typePolicies: {
          Query: {
            fields: {
              books: {
                merge(existing: any[] = [], incoming: any[], {
                  readField,
                }) {
                  if (existing) {
                    const merged = existing.slice(0);
                    const existingIsbnSet =
                      new Set(merged.map(book => readField("isbn", book)));
                    incoming.forEach(book => {
                      const isbn = readField("isbn", book);
                      if (!existingIsbnSet.has(isbn)) {
                        existingIsbnSet.add(isbn);
                        merged.push(book);
                      }
                    });
                    return merged;
                  }
                  return incoming;
                },

                // Returns the books array, sorted by title.
                read(existing: any[], { readField }) {
                  if (existing) {
                    return existing.slice(0).sort((a, b) => {
                      const aTitle = readField<string>("title", a);
                      const bTitle = readField<string>("title", b);
                      if (aTitle === bTitle) return 0;
                      if (aTitle! < bTitle!) return -1;
                      return 1;
                    });
                  }
                  return [];
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
        query {
          books {
            isbn
            title
          }
        }
      `;

      const programmingRustBook = {
        __typename: "Book",
        isbn: "9781491927281",
        title: "Programming Rust: Fast, Safe Systems Development",
      };

      const officialRustBook = {
        __typename: "Book",
        isbn: "1593278284",
        title: "The Rust Programming Language",
      };

      const handsOnConcurrencyBook = {
        __typename: "Book",
        isbn: "1788399978",
        title: "Hands-On Concurrency with Rust",
      };

      const wasmWithRustBook = {
        __typename: "Book",
        isbn: "1680506366",
        title: "Programming WebAssembly with Rust",
      };

      function addBooks(...books: (typeof programmingRustBook)[]) {
        cache.writeQuery({
          query,
          data: {
            books,
          },
        });
      }

      addBooks(officialRustBook);

      expect(cache.extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          books: [
            { __ref: 'Book:{"isbn":"1593278284"}' },
          ],
        },
        'Book:{"isbn":"1593278284"}': {
          __typename: "Book",
          isbn: "1593278284",
          title: "The Rust Programming Language",
        },
      });

      addBooks(
        programmingRustBook,
        officialRustBook,
      );

      expect(cache.extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          books: [
            { __ref: 'Book:{"isbn":"1593278284"}' },
            { __ref: 'Book:{"isbn":"9781491927281"}' },
          ],
        },
        'Book:{"isbn":"1593278284"}': officialRustBook,
        'Book:{"isbn":"9781491927281"}': programmingRustBook,
      });

      addBooks(
        wasmWithRustBook,
        wasmWithRustBook,
        programmingRustBook,
        wasmWithRustBook,
      );

      expect(cache.extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          books: [
            { __ref: 'Book:{"isbn":"1593278284"}' },
            { __ref: 'Book:{"isbn":"9781491927281"}' },
            { __ref: 'Book:{"isbn":"1680506366"}' },
          ],
        },
        'Book:{"isbn":"1593278284"}': officialRustBook,
        'Book:{"isbn":"9781491927281"}': programmingRustBook,
        'Book:{"isbn":"1680506366"}': wasmWithRustBook,
      });

      addBooks(
        programmingRustBook,
        officialRustBook,
        handsOnConcurrencyBook,
        wasmWithRustBook,
      );

      expect(cache.extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          books: [
            { __ref: 'Book:{"isbn":"1593278284"}' },
            { __ref: 'Book:{"isbn":"9781491927281"}' },
            { __ref: 'Book:{"isbn":"1680506366"}' },
            { __ref: 'Book:{"isbn":"1788399978"}' },
          ],
        },
        'Book:{"isbn":"1593278284"}': officialRustBook,
        'Book:{"isbn":"9781491927281"}': programmingRustBook,
        'Book:{"isbn":"1680506366"}': wasmWithRustBook,
        'Book:{"isbn":"1788399978"}': handsOnConcurrencyBook,
      });

      expect(cache.readQuery({ query })).toEqual({
        // Note that these books have been sorted by title, thanks to the
        // custom read function we defined above.
        "books": [
          {
            "__typename": "Book",
            "isbn": "1788399978",
            "title": "Hands-On Concurrency with Rust",
          },
          {
            "__typename": "Book",
            "isbn": "9781491927281",
            "title": "Programming Rust: Fast, Safe Systems Development",
          },
          {
            "__typename": "Book",
            "isbn": "1680506366",
            "title": "Programming WebAssembly with Rust",
          },
          {
            "__typename": "Book",
            "isbn": "1593278284",
            "title": "The Rust Programming Language",
          },
        ],
      });
    });

    withErrorSpy(it, "readField helper function calls custom read functions", function () {
      // Rather than writing ownTime data into the cache, we maintain it
      // externally in this object:
      const ownTimes: Record<string, ReactiveVar<number>> = {
        "parent task": makeVar(2),
        "child task 1": makeVar(3),
        "child task 2": makeVar(4),
        "grandchild task": makeVar(5),
        "independent task": makeVar(11),
      };

      const cache = new InMemoryCache({
        typePolicies: {
          Agenda: {
            fields: {
              taskCount(_, { readField }) {
                return readField<Reference[]>("tasks")!.length;
              },

              tasks: {
                // Thanks to this read function, the readField("tasks")
                // call above will always return an array, so we don't
                // have to guard against the possibility that the tasks
                // data is undefined above.
                read(existing = []) {
                  return existing;
                },

                merge(existing: Reference[], incoming: Reference[]) {
                  const merged = existing ? existing.slice(0) : [];
                  merged.push(...incoming);
                  return merged;
                },
              },
            },
          },

          Task: {
            fields: {
              ownTime(_, { readField }) {
                const description = readField<string>("description");
                return ownTimes[description!]() || 0;
              },

              totalTime(_, { readField, toReference }) {
                function total(
                  blockers: Readonly<Reference[]> = [],
                  seen = new Set<string>(),
                ) {
                  let time = 0;
                  blockers.forEach(blocker => {
                    if (!seen.has(blocker.__ref)) {
                      seen.add(blocker.__ref);
                      time += readField<number>("ownTime", blocker)!;
                      time += total(
                        readField<Reference[]>("blockers", blocker),
                        seen,
                      );
                    }
                  });
                  return time;
                }
                return total([
                  toReference({
                    __typename: "Task",
                    id: readField("id"),
                  }) as Reference,
                ]);
              },

              blockers: {
                merge(existing: Reference[] = [], incoming: Reference[]) {
                  const seenIDs = new Set(existing.map(ref => ref.__ref));
                  const merged = existing.slice(0);
                  incoming.forEach(ref => {
                    if (!seenIDs.has(ref.__ref)) {
                      seenIDs.add(ref.__ref);
                      merged.push(ref);
                    }
                  });
                  return merged;
                },
              },
            },
          },
        },
      });

      cache.writeQuery({
        query: gql`
          query {
            agenda {
              id
              tasks {
                id
                description
                blockers {
                  id
                }
              }
            }
          }
        `,
        data: {
          agenda: {
            __typename: "Agenda",
            id: 1,
            tasks: [{
              __typename: "Task",
              id: 1,
              description: "parent task",
              blockers: [{
                __typename: "Task",
                id: 2,
              }, {
                __typename: "Task",
                id: 3,
              }],
            }, {
              __typename: "Task",
              id: 2,
              description: "child task 1",
              blockers: [{
                __typename: "Task",
                id: 4,
              }],
            }, {
              __typename: "Task",
              id: 3,
              description: "child task 2",
              blockers: [{
                __typename: "Task",
                id: 4,
              }],
            }, {
              __typename: "Task",
              id: 4,
              description: "grandchild task",
            }],
          },
        },
      });

      expect(cache.extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          agenda: { __ref: "Agenda:1" },
        },
        "Agenda:1": {
          __typename: "Agenda",
          id: 1,
          tasks: [
            { __ref: "Task:1" },
            { __ref: "Task:2" },
            { __ref: "Task:3" },
            { __ref: "Task:4" },
          ],
        },
        "Task:1": {
          __typename: "Task",
          blockers: [
            { __ref: "Task:2" },
            { __ref: "Task:3" },
          ],
          description: "parent task",
          id: 1,
        },
        "Task:2": {
          __typename: "Task",
          blockers: [
            { __ref: "Task:4" },
          ],
          description: "child task 1",
          id: 2,
        },
        "Task:3": {
          __typename: "Task",
          blockers: [
            { __ref: "Task:4" },
          ],
          description: "child task 2",
          id: 3,
        },
        "Task:4": {
          __typename: "Task",
          description: "grandchild task",
          id: 4,
        },
      });

      const query = gql`
        query {
          agenda {
            taskCount
            tasks {
              description
              ownTime
              totalTime
            }
          }
        }
      `;

      function read(): { agenda: any } | null {
        return cache.readQuery({ query });
      }

      const firstResult = read();

      expect(firstResult).toEqual({
        agenda: {
          __typename: "Agenda",
          taskCount: 4,
          tasks: [{
            __typename: "Task",
            description: "parent task",
            ownTime: 2,
            totalTime: 2 + 3 + 4 + 5,
          }, {
            __typename: "Task",
            description: "child task 1",
            ownTime: 3,
            totalTime: 3 + 5,
          }, {
            __typename: "Task",
            description: "child task 2",
            ownTime: 4,
            totalTime: 4 + 5,
          }, {
            __typename: "Task",
            description: "grandchild task",
            ownTime: 5,
            totalTime: 5,
          }],
        },
      });

      expect(read()).toBe(firstResult);

      ownTimes["child task 2"](6);

      const secondResult = read();
      expect(secondResult).not.toBe(firstResult);
      expect(secondResult).toEqual({
        agenda: {
          __typename: "Agenda",
          taskCount: 4,
          tasks: [{
            __typename: "Task",
            description: "parent task",
            ownTime: 2,
            totalTime: 2 + 3 + 6 + 5,
          }, {
            __typename: "Task",
            description: "child task 1",
            ownTime: 3,
            totalTime: 3 + 5,
          }, {
            __typename: "Task",
            description: "child task 2",
            ownTime: 6,
            totalTime: 6 + 5,
          }, {
            __typename: "Task",
            description: "grandchild task",
            ownTime: 5,
            totalTime: 5,
          }],
        },
      });
      expect(secondResult!.agenda.tasks[0]).not.toBe(firstResult!.agenda.tasks[0]);
      expect(secondResult!.agenda.tasks[1]).toBe(firstResult!.agenda.tasks[1]);
      expect(secondResult!.agenda.tasks[2]).not.toBe(firstResult!.agenda.tasks[2]);
      expect(secondResult!.agenda.tasks[3]).toBe(firstResult!.agenda.tasks[3]);

      ownTimes["grandchild task"](7);

      const thirdResult = read();
      expect(thirdResult).not.toBe(secondResult);
      expect(thirdResult).toEqual({
        agenda: {
          __typename: "Agenda",
          taskCount: 4,
          tasks: [{
            __typename: "Task",
            description: "parent task",
            ownTime: 2,
            totalTime: 2 + 3 + 6 + 7,
          }, {
            __typename: "Task",
            description: "child task 1",
            ownTime: 3,
            totalTime: 3 + 7,
          }, {
            __typename: "Task",
            description: "child task 2",
            ownTime: 6,
            totalTime: 6 + 7,
          }, {
            __typename: "Task",
            description: "grandchild task",
            ownTime: 7,
            totalTime: 7,
          }],
        },
      });

      cache.writeQuery({
        query: gql`
          query {
            agenda {
              id
              tasks {
                id
                description
              }
            }
          }
        `,
        data: {
          agenda: {
            __typename: "Agenda",
            id: 1,
            tasks: [{
              __typename: "Task",
              id: 5,
              description: "independent task",
            }],
          },
        },
      });

      expect(cache.extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          agenda: { __ref: "Agenda:1" },
        },
        "Agenda:1": {
          __typename: "Agenda",
          id: 1,
          tasks: [
            { __ref: "Task:1" },
            { __ref: "Task:2" },
            { __ref: "Task:3" },
            { __ref: "Task:4" },
            { __ref: "Task:5" },
          ],
        },
        "Task:1": {
          __typename: "Task",
          blockers: [
            { __ref: "Task:2" },
            { __ref: "Task:3" },
          ],
          description: "parent task",
          id: 1,
        },
        "Task:2": {
          __typename: "Task",
          blockers: [
            { __ref: "Task:4" },
          ],
          description: "child task 1",
          id: 2,
        },
        "Task:3": {
          __typename: "Task",
          blockers: [
            { __ref: "Task:4" },
          ],
          description: "child task 2",
          id: 3,
        },
        "Task:4": {
          __typename: "Task",
          description: "grandchild task",
          id: 4,
        },
        "Task:5": {
          __typename: "Task",
          description: "independent task",
          id: 5,
        },
      });

      const fourthResult = read();
      expect(fourthResult).not.toBe(thirdResult);
      expect(fourthResult).toEqual({
        agenda: {
          __typename: "Agenda",
          taskCount: 5,
          tasks: [{
            __typename: "Task",
            description: "parent task",
            ownTime: 2,
            totalTime: 2 + 3 + 6 + 7,
          }, {
            __typename: "Task",
            description: "child task 1",
            ownTime: 3,
            totalTime: 3 + 7,
          }, {
            __typename: "Task",
            description: "child task 2",
            ownTime: 6,
            totalTime: 6 + 7,
          }, {
            __typename: "Task",
            description: "grandchild task",
            ownTime: 7,
            totalTime: 7,
          }, {
            __typename: "Task",
            description: "independent task",
            ownTime: 11,
            totalTime: 11,
          }],
        },
      });

      function checkFirstFourIdentical(result: ReturnType<typeof read>) {
        for (let i = 0; i < 4; ++i) {
          expect(result!.agenda.tasks[i]).toBe(thirdResult!.agenda.tasks[i]);
        }
      }
      // The four original task results should not have been altered by
      // the addition of a fifth independent task.
      checkFirstFourIdentical(fourthResult);

      const indVar = ownTimes["independent task"];
      indVar(indVar() + 1);

      const fifthResult = read();
      expect(fifthResult).not.toBe(fourthResult);
      expect(fifthResult).toEqual({
        agenda: {
          __typename: "Agenda",
          taskCount: 5,
          tasks: [
            fourthResult!.agenda.tasks[0],
            fourthResult!.agenda.tasks[1],
            fourthResult!.agenda.tasks[2],
            fourthResult!.agenda.tasks[3],
            {
              __typename: "Task",
              description: "independent task",
              ownTime: 12,
              totalTime: 12,
            },
          ],
        },
      });
      checkFirstFourIdentical(fifthResult);
    });

    it("can return void to indicate missing field", function () {
      let secretReadAttempted = false;

      const cache = new InMemoryCache({
        typePolicies: {
          Person: {
            fields: {
              secret() {
                secretReadAttempted = true;
                // Return nothing to signal field is missing.
              },
            },
          },
        },
      });

      const query = gql`
        query {
          me {
            name
          }
        }
      `;

      cache.writeQuery({
        query,
        data: {
          me: {
            __typename: "Person",
            name: "Ben Newman",
          },
        },
      });

      expect(secretReadAttempted).toBe(false);

      expect(cache.readQuery({
        query: gql`
          query {
            me {
              secret
            }
          }
        `,
      })).toBe(null);

      expect(() => cache.diff({
        optimistic: true,
        returnPartialData: false,
        query: gql`
          query {
            me {
              secret
            }
          }
        `,
      })).toThrowError("Can't find field 'secret' ");

      expect(secretReadAttempted).toBe(true);
    });

    it("can define custom merge functions", function () {
      const cache = new InMemoryCache({
        typePolicies: {
          Person: {
            // Disables normalization for the Person type, which means the
            // todos field will be nested inside a non-normalized object
            // (with __typename "Person") directly under the ROOT_QUERY.me
            // field, which exercises what happens when mergeOverrides
            // becomes nested (see writeToStore.ts).
            keyFields: false,

            fields: {
              todos: {
                keyArgs: [],

                read(existing: any[], {
                  args,
                  toReference,
                  isReference,
                }) {
                  expect(!existing || Object.isFrozen(existing)).toBe(true);
                  expect(typeof toReference).toBe("function");
                  const slice = existing.slice(
                    args!.offset,
                    args!.offset + args!.limit,
                  );
                  slice.forEach(ref => expect(isReference(ref)).toBe(true));
                  return slice;
                },

                merge(existing: any[], incoming: any[], {
                  args,
                  toReference,
                  isReference,
                }) {
                  expect(!existing || Object.isFrozen(existing)).toBe(true);
                  expect(typeof toReference).toBe("function");
                  const copy = existing ? existing.slice(0) : [];
                  const limit = args!.offset + args!.limit;
                  for (let i = args!.offset; i < limit; ++i) {
                    copy[i] = incoming[i - args!.offset];
                  }
                  copy.forEach(todo => expect(isReference(todo)).toBe(true));
                  return copy;
                }
              },
            },
          },

          Todo: {
            keyFields: ["id"],
          },
        },
      });

      const query = gql`
        query {
          me {
            todos(offset: $offset, limit: $limit) {
              text
            }
          }
        }
      `;

      cache.writeQuery({
        query,
        data: {
          me: {
            __typename: "Person",
            id: "ignored",
            todos: [
              { __typename: "Todo", id: 1, text: "Write more merge tests" },
              { __typename: "Todo", id: 2, text: "Write pagination tests" },
            ],
          },
        },
        variables: {
          offset: 0,
          limit: 2,
        },
      });

      expect(cache.extract(true)).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          me: {
            __typename: "Person",
            "todos:{}": [
              { __ref: 'Todo:{"id":1}' },
              { __ref: 'Todo:{"id":2}' },
            ],
          },
        },
        'Todo:{"id":1}': {
          __typename: "Todo",
          id: 1,
          text: "Write more merge tests",
        },
        'Todo:{"id":2}': {
          __typename: "Todo",
          id: 2,
          text: "Write pagination tests",
        },
      });

      cache.writeQuery({
        query,
        data: {
          me: {
            __typename: "Person",
            todos: [
              { __typename: "Todo", id: 5, text: "Submit pull request" },
              { __typename: "Todo", id: 6, text: "Merge pull request" },
            ],
          },
        },
        variables: {
          offset: 4,
          limit: 2,
        },
      });

      expect(cache.extract(true)).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          me: {
            __typename: "Person",
            "todos:{}": [
              { __ref: 'Todo:{"id":1}' },
              { __ref: 'Todo:{"id":2}' },
              void 0,
              void 0,
              { __ref: 'Todo:{"id":5}' },
              { __ref: 'Todo:{"id":6}' },
            ],
          },
        },
        'Todo:{"id":1}': {
          __typename: "Todo",
          id: 1,
          text: "Write more merge tests",
        },
        'Todo:{"id":2}': {
          __typename: "Todo",
          id: 2,
          text: "Write pagination tests",
        },
        'Todo:{"id":5}': {
          __typename: "Todo",
          id: 5,
          text: "Submit pull request",
        },
        'Todo:{"id":6}': {
          __typename: "Todo",
          id: 6,
          text: "Merge pull request",
        },
      });

      cache.writeQuery({
        query,
        data: {
          me: {
            __typename: "Person",
            todos: [
              { __typename: "Todo", id: 3, text: "Iron out merge API" },
              { __typename: "Todo", id: 4, text: "Take a nap" },
            ],
          },
        },
        variables: {
          offset: 2,
          limit: 2,
        },
      });

      expect(cache.extract(true)).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          me: {
            __typename: "Person",
            "todos:{}": [
              { __ref: 'Todo:{"id":1}' },
              { __ref: 'Todo:{"id":2}' },
              { __ref: 'Todo:{"id":3}' },
              { __ref: 'Todo:{"id":4}' },
              { __ref: 'Todo:{"id":5}' },
              { __ref: 'Todo:{"id":6}' },
            ],
          },
        },
        'Todo:{"id":1}': {
          __typename: "Todo",
          id: 1,
          text: "Write more merge tests",
        },
        'Todo:{"id":2}': {
          __typename: "Todo",
          id: 2,
          text: "Write pagination tests",
        },
        'Todo:{"id":3}': {
          __typename: "Todo",
          id: 3,
          text: "Iron out merge API",
        },
        'Todo:{"id":4}': {
          __typename: "Todo",
          id: 4,
          text: "Take a nap",
        },
        'Todo:{"id":5}': {
          __typename: "Todo",
          id: 5,
          text: "Submit pull request",
        },
        'Todo:{"id":6}': {
          __typename: "Todo",
          id: 6,
          text: "Merge pull request",
        },
      });

      expect(cache.gc()).toEqual([]);

      // The moment of truth!
      expect(
        cache.readQuery({
          query,
          variables: {
            offset: 1,
            limit: 4,
          },
        })
      ).toEqual({
        me: {
          __typename: "Person",
          todos: [
            { __typename: "Todo", text: "Write pagination tests" },
            { __typename: "Todo", text: "Iron out merge API" },
            { __typename: "Todo", text: "Take a nap" },
            { __typename: "Todo", text: "Submit pull request" },
          ],
        },
      });
    });

    itAsync("can handle Relay-style pagination without args", (resolve, reject) => {
      const cache = new InMemoryCache({
        addTypename: false,
        typePolicies: {
          Query: {
            fields: {
              todos: relayStylePagination(),
            },
          },
        },
      });

      const firstQuery = gql`
        query TodoQuery {
          todos {
            totalCount
          }
        }
      `

      const secondQuery = gql`
        query TodoQuery {
          todos(after: $after, first: $first) {
            pageInfo {
              __typename
              hasNextPage
              endCursor
            }
            totalCount
            edges {
              __typename
              id
              node {
                __typename
                id
                title
              }
            }
          }
        }
      `

      const thirdQuery = gql`
        query TodoQuery {
          todos {
            totalCount
            extraMetaData
          }
        }
      `

      const secondVariables = {
        first: 1,
      };

      const secondEdges = [
        {
          __typename: "TodoEdge",
          id: "edge1",
          node: {
            __typename: "Todo",
            id: '1',
            title: 'Fix the tests'
          }
        },
      ];

      const secondPageInfo = {
        __typename: "PageInfo",
        endCursor: "YXJyYXljb25uZWN0aW9uOjI=",
        hasNextPage: true,
      };

      const link = new MockLink([
        {
          request: {
            query: firstQuery,
          },
          result: {
            data: {
              todos: {
                totalCount: 1292
              }
            }
          }
        },
        {
          request: {
            query: secondQuery,
            variables: secondVariables,
          },
          result: {
            data: {
              todos: {
                edges: secondEdges,
                pageInfo: secondPageInfo,
                totalCount: 1292,
              }
            }
          },
        },
        {
          request: {
            query: thirdQuery,
          },
          result: {
            data: {
              todos: {
                totalCount: 1293,
                extraMetaData: 'extra',
              }
            }
          },
        }
      ]).setOnError(reject);

      const client = new ApolloClient({ link, cache });

      client.query({query: firstQuery}).then(result => {
        expect(result).toEqual({
          loading: false,
          networkStatus: NetworkStatus.ready,
          data: {
            todos: {
              totalCount: 1292
            }
          }
        })

        expect(cache.extract()).toEqual({
          ROOT_QUERY: {
            __typename: "Query",
            todos: {
              edges: [],
              pageInfo: {
                "endCursor": "",
                "hasNextPage": true,
                "hasPreviousPage": false,
                "startCursor": "",
               },
               totalCount: 1292
             },
          }
        });

        client.query({query: secondQuery, variables: secondVariables}).then(result => {
          expect(result).toEqual({
            loading: false,
            networkStatus: NetworkStatus.ready,
            data: {
              todos: {
                edges: secondEdges,
                pageInfo: secondPageInfo,
                totalCount: 1292,
              }
            }
          })

          expect(cache.extract()).toMatchSnapshot()

          client.query({query: thirdQuery}).then(result => {
            expect(result).toEqual({
              loading: false,
              networkStatus: NetworkStatus.ready,
              data: {
                todos: {
                  totalCount: 1293,
                  extraMetaData: 'extra',
                }
              }
            })
            expect(cache.extract()).toMatchSnapshot()
            resolve()
          })
        })
      })
    })

    itAsync("can handle Relay-style pagination", (resolve, reject) => {
      const cache = new InMemoryCache({
        addTypename: false,
        typePolicies: {
          Query: {
            fields: {
              search: relayStylePagination((args, { fieldName }) => {
                expect(typeof args!.query).toBe("string");
                expect(fieldName).toBe("search");
                // Normalize the search query by lower-casing it.
                return args!.query.toLowerCase();
              }),
            },
          },

          Artist: {
            keyFields: ["href"],
          },
        },
      });

      const query = gql`
        query ArtsySearch(
          $query: String!,
          $after: String, $first: Int,
          $before: String, $last: Int,
        ) {
          search(
            query: $query,
            after: $after, first: $first,
            before: $before, last: $last,
          ) {
            edges {
              __typename
              node {
                __typename
                displayLabel
                ... on Artist { __typename href bio }
                ... on SearchableItem { __typename description }
              }
            }
            pageInfo {
              __typename
              startCursor
              endCursor
              hasPreviousPage
              hasNextPage
            }
            totalCount
          }
        }
      `;

      const firstVariables = {
        query: "Basquiat",
        first: 3,
      };

      const firstEdges = [
        {
          __typename: "SearchableEdge",
          node: {
            __typename: "Artist",
            href: "/artist/jean-michel-basquiat",
            displayLabel: "Jean-Michel Basquiat",
            bio: "American, 1960-1988, New York, New York, based in New York, New York"
          }
        },
        {
          __typename: "SearchableEdge",
          node: {
            displayLabel: "ephemera BASQUIAT",
            __typename: "SearchableItem",
            description: "Past show featuring works by Damien Hirst, " +
              "James Rosenquist, David Salle, Andy Warhol, Jeff Koons, " +
              "Jean-Michel Basquiat, Keith Haring, Kiki Smith, Sandro Chia, " +
              "Kenny Scharf, Mike Bidlo, Jon Schueler, William Wegman, " +
              "David Wojnarowicz, Taylor Mead, William S. Burroughs, " +
              "Michael Halsband, Rene Ricard, and Chris DAZE Ellis"
          }
        },
        {
          __typename: "SearchableEdge",
          node: {
            displayLabel: "Jean-Michel Basquiat | Xerox",
            __typename: "SearchableItem",
            description: "Past show featuring works by Jean-Michel " +
              "Basquiat at Nahmad Contemporary Mar 12th – May 31st 2019"
          }
        }
      ];

      const firstPageInfo = {
        __typename: "PageInfo",
        startCursor: "YXJyYXljb25uZWN0aW9uOjA=",
        endCursor: "YXJyYXljb25uZWN0aW9uOjI=",
        hasPreviousPage: false,
        hasNextPage: true,
      };

      const secondVariables = {
        query: "Basquiat",
        after: firstPageInfo.endCursor,
        first: 3,
      };

      const secondEdges = [
        {
          __typename: "SearchableEdge",
          node: {
            displayLabel: "STREET ART: From Basquiat to Banksy",
            __typename: "SearchableItem",
            description: "Past show featuring works by Banksy, SEEN, " +
              "JonOne and QUIK at Artrust Oct 8th – Dec 16th 2017",
          }
        },
        {
          __typename: "SearchableEdge",
          node: {
            __typename: "SearchableItem",
            displayLabel: "STREET ART 2: From Basquiat to Banksy",
            description: "Past show featuring works by Jean-Michel Basquiat, " +
              "Shepard Fairey, COPE2, Pure Evil, Sickboy, Blade, " +
              "Kurar, and LARS at Artrust",
          }
        },
        {
          __typename: "SearchableEdge",
          node: {
            __typename: "Artist",
            href: "/artist/reminiscent-of-basquiat",
            displayLabel: "Reminiscent of Basquiat",
            bio: ""
          }
        }
      ];

      const secondPageInfo = {
        __typename: "PageInfo",
        startCursor: "YXJyYXljb25uZWN0aW9uOjM=",
        endCursor: "YXJyYXljb25uZWN0aW9uOjU=",
        hasPreviousPage: false,
        hasNextPage: true,
      };

      const thirdVariables = {
        // Intentionally lower-case Basquiat here to make sure the results
        // end up merged with other capitalized results.
        query: "basquiat",
        before: secondPageInfo.startCursor,
        last: 2,
        // Make sure these variables are not inherited.
        after: void 0,
        first: void 0,
      };

      const thirdEdges = firstEdges.slice(1);

      const thirdPageInfo = {
        __typename: "PageInfo",
        startCursor: "YXJyYXljb25uZWN0aW9uOjE=",
        endCursor: "YXJyYXljb25uZWN0aW9uOjM=",
        hasPreviousPage: true,
        hasNextPage: true,
      };

      const fourthVariables = {
        query: "basquiat",
        before: thirdPageInfo.startCursor,
        last: 1,
        // Make sure these variables are not inherited.
        after: void 0,
        first: void 0,
      };

      // Just the initial Basquiat Artist edge.
      const fourthEdges = firstEdges.slice(0, 1);

      const fourthPageInfo = {
        __typename: "PageInfo",
        startCursor: "YXJyYXljb25uZWN0aW9uOjA=",
        endCursor: "YXJyYXljb25uZWN0aW9uOjA=",
        hasPreviousPage: false,
        hasNextPage: true,
      };

      const fifthVariables = {
        query: "Basquiat",
        after: secondPageInfo.endCursor,
        first: 1,
      };

      const fifthEdges = [{
        __typename: "SearchableEdge",
        node: {
          __typename: "SearchableItem",
          displayLabel: "Basquiat: The Unknown Notebooks",
          description: "Past show featuring works by Jean-Michel Basquiat " +
            "at Brooklyn Museum Apr 3rd – Aug 23rd 2015",
        },
      }];

      const fifthPageInfo = {
        __typename: "PageInfo",
        startCursor: "YXJyYXljb25uZWN0aW9uOjY=",
        endCursor: "YXJyYXljb25uZWN0aW9uOjY=",
        hasPreviousPage: true,
        hasNextPage: true,
      };

      const turrellVariables1 = {
        query: "James Turrell",
        first: 1,
      };

      const turrellVariables2 = {
        query: "James Turrell",
        first: 2,
      };

      const turrellEdges = [
        {
          __typename: "SearchableEdge",
          node: {
            __typename: "Artist",
            href: "/artist/james-turrell",
            displayLabel: "James Turrell",
            bio: "American, born 1943, Los Angeles, California",
          },
        },
        {
          __typename: "SearchableEdge",
          node: {
            __typename: "SearchableItem",
            displayLabel: "James Turrell: Light knows when we’re looking",
            description: "<placeholder for unknown description>",
          },
        },
      ];

      const turrellPageInfo1 = {
        __typename: "PageInfo",
        startCursor: "YXJyYXljb25uZWN0aW9uOjA=",
        endCursor: "YXJyYXljb25uZWN0aW9uOjA=",
        hasPreviousPage: false,
        hasNextPage: true,
      };

      const turrellPageInfo2 = {
        ...turrellPageInfo1,
        endCursor: "YXJyYXljb25uZWN0aW9uOjEx",
      };

      const link = new MockLink([
        {
          request: {
            query,
            variables: firstVariables,
          },
          result: {
            data: {
              search: {
                edges: firstEdges,
                pageInfo: firstPageInfo,
                totalCount: 1292,
              }
            }
          },
        },
        {
          request: {
            query,
            variables: secondVariables,
          },
          result: {
            data: {
              search: {
                edges: secondEdges,
                pageInfo: secondPageInfo,
                totalCount: 1292,
              },
            },
          },
        },
        {
          request: {
            query,
            variables: thirdVariables,
          },
          result: {
            data: {
              search: {
                edges: thirdEdges,
                pageInfo: thirdPageInfo,
                totalCount: 1292,
              },
            },
          },
        },
        {
          request: {
            query,
            variables: fourthVariables,
          },
          result: {
            data: {
              search: {
                edges: fourthEdges,
                pageInfo: fourthPageInfo,
                totalCount: 1292,
              },
            },
          },
        },
        {
          request: {
            query,
            variables: fifthVariables,
          },
          result: {
            data: {
              search: {
                edges: fifthEdges,
                pageInfo: fifthPageInfo,
                totalCount: 1292,
              },
            },
          },
        },
        {
          request: {
            query,
            variables: turrellVariables1,
          },
          result: {
            data: {
              search: {
                edges: turrellEdges.slice(0, 1),
                pageInfo: turrellPageInfo1,
                totalCount: 13531,
              },
            },
          },
        },
        {
          request: {
            query,
            variables: turrellVariables2,
          },
          result: {
            data: {
              search: {
                edges: turrellEdges,
                pageInfo: turrellPageInfo2,
                totalCount: 13531,
              },
            },
          },
        },
      ]).setOnError(reject);

      const client = new ApolloClient({ link, cache });

      const observable = client.watchQuery<any, {
        query: string,
        after?: string,
        first?: number,
        before?: string,
        last?: number,
      }>({
        query,
        variables: {
          query: "Basquiat",
          first: 3,
        },
      });

      subscribeAndCount(reject, observable, (count, result) => {
        if (count === 1) {
          expect(result).toEqual({
            loading: false,
            networkStatus: NetworkStatus.ready,
            data: {
              search: {
                edges: firstEdges,
                pageInfo: firstPageInfo,
                totalCount: 1292,
              },
            },
          });

          expect(cache.extract()).toMatchSnapshot();

          observable.fetchMore({
            variables: secondVariables,
          });

        } else if (count === 2) {
          expect(result).toEqual({
            loading: false,
            networkStatus: NetworkStatus.ready,
            data: {
              search: {
                edges: [
                  ...firstEdges,
                  ...secondEdges,
                ],
                pageInfo: {
                  __typename: "PageInfo",
                  startCursor: firstPageInfo.startCursor,
                  endCursor: secondPageInfo.endCursor,
                  hasPreviousPage: false,
                  hasNextPage: true,
                },
                totalCount: 1292,
              },
            },
          });

          expect(cache.extract()).toMatchSnapshot();

          observable.fetchMore({
            variables: thirdVariables,
          });

        } else if (count === 3) {
          expect(result.data.search.edges.length).toBe(5);

          expect(result).toEqual({
            loading: false,
            networkStatus: NetworkStatus.ready,
            data: {
              search: {
                edges: [
                  ...thirdEdges,
                  ...secondEdges,
                ],
                pageInfo: {
                  __typename: "PageInfo",
                  startCursor: thirdPageInfo.startCursor,
                  endCursor: secondPageInfo.endCursor,
                  hasPreviousPage: true,
                  hasNextPage: true,
                },
                totalCount: 1292,
              },
            },
          });

          expect(cache.extract()).toMatchSnapshot();

          observable.fetchMore({
            variables: fourthVariables,
          });

        } else if (count === 4) {
          expect(result).toEqual({
            loading: false,
            networkStatus: NetworkStatus.ready,
            data: {
              search: {
                edges: [
                  ...fourthEdges,
                  ...thirdEdges,
                  ...secondEdges,
                ],
                pageInfo: {
                  __typename: "PageInfo",
                  startCursor: firstPageInfo.startCursor,
                  endCursor: secondPageInfo.endCursor,
                  hasPreviousPage: false,
                  hasNextPage: true,
                },
                totalCount: 1292,
              },
            },
          });

          expect(result.data.search.edges).toEqual([
            ...firstEdges,
            ...secondEdges,
          ]);

          expect(cache.extract()).toMatchSnapshot();

          observable.fetchMore({
            variables: fifthVariables,
          });

        } else if (count === 5) {
          expect(result.data.search.edges.length).toBe(7);

          expect(result).toEqual({
            loading: false,
            networkStatus: NetworkStatus.ready,
            data: {
              search: {
                edges: [
                  ...firstEdges,
                  ...secondEdges,
                  ...fifthEdges,
                ],
                pageInfo: {
                  __typename: "PageInfo",
                  startCursor: firstPageInfo.startCursor,
                  endCursor: fifthPageInfo.endCursor,
                  hasPreviousPage: false,
                  hasNextPage: true,
                },
                totalCount: 1292,
              },
            },
          });

          expect(cache.extract()).toMatchSnapshot();

          // Now search for a different artist to verify that they keyArgs
          // function we passed to relayStylePagination above keeps
          // different search queries separate in the cache.
          client.query({
            query,
            variables: {
              query: "James Turrell",
              first: 1,
            },
          }).then(result => {
            expect(result).toEqual({
              loading: false,
              networkStatus: NetworkStatus.ready,
              data: {
                search: {
                  edges: turrellEdges.slice(0, 1),
                  pageInfo: turrellPageInfo1,
                  totalCount: 13531,
                },
              },
            });

            const snapshot = cache.extract();
            expect(snapshot).toMatchSnapshot();
            expect(
              // Note that Turrell's name has been lower-cased.
              snapshot.ROOT_QUERY!["search:james turrell"]
            ).toEqual({
              edges: turrellEdges.slice(0, 1).map(edge => ({
                ...edge,
                // The relayStylePagination merge function updates the
                // edge.cursor field of the first and last edge, even if
                // the query did not request the edge.cursor field, if
                // pageInfo.{start,end}Cursor are defined.
                cursor: turrellPageInfo1.startCursor,
                // Artist objects are normalized by HREF:
                node: { __ref: 'Artist:{"href":"/artist/james-turrell"}' },
              })),
              pageInfo: turrellPageInfo1,
              totalCount: 13531,
            });

            // Evict the Basquiat entity to verify that the dangling
            // edge.node Reference gets automatically elided from the
            // Basquiat search results, thanks to the read function
            // generated by the relayStylePagination helper.
            expect(cache.evict({
              id: cache.identify({
                __typename: "Artist",
                href: "/artist/jean-michel-basquiat",
              }),
            })).toBe(true);
          }, reject);

        } else if (count === 6) {
          // Same full list of edges that we saw in the previous case.
          const edges = [
            ...firstEdges,
            ...secondEdges,
            ...fifthEdges,
          ];

          // Remove the Basquiat edge, which we know to be first.
          expect(edges.shift()).toEqual({
            __typename: "SearchableEdge",
            node: {
              __typename: "Artist",
              href: "/artist/jean-michel-basquiat",
              displayLabel: "Jean-Michel Basquiat",
              bio: "American, 1960-1988, New York, New York, based in New York, New York",
            },
          });

          expect(result).toEqual({
            loading: false,
            networkStatus: NetworkStatus.ready,
            data: {
              search: {
                edges,
                pageInfo: {
                  __typename: "PageInfo",
                  startCursor: fourthPageInfo.startCursor,
                  endCursor: fifthPageInfo.endCursor,
                  hasPreviousPage: false,
                  hasNextPage: true,
                },
                totalCount: 1292,
              },
            },
          });

          expect(cache.extract()).toMatchSnapshot();

          // Now search for James Turrell again with args.first === 2
          // (turrellVariables2), but without args.after, so that the
          // new results overwrite the existing results (#6592).
          client.query({
            query,
            variables: turrellVariables2,
            // Necessary to skip the cache, like fetchMore does.
            fetchPolicy: "network-only",
          }).then(result => {
            expect(result).toEqual({
              loading: false,
              networkStatus: NetworkStatus.ready,
              data: {
                search: {
                  edges: turrellEdges,
                  pageInfo: turrellPageInfo2,
                  totalCount: 13531,
                },
              },
            });

            const snapshot = cache.extract();
            expect(snapshot).toMatchSnapshot();
            expect(
              // Note that Turrell's name has been lower-cased.
              snapshot.ROOT_QUERY!["search:james turrell"]
            ).toEqual({
              edges: turrellEdges.map((edge, i) => ({
                ...edge,
                // This time the cursors are different depending on which
                // of the two edges we're considering.
                cursor: [
                  turrellPageInfo2.startCursor,
                  turrellPageInfo2.endCursor,
                ][i],
                node: [
                  // Artist objects are normalized by HREF:
                  { __ref: 'Artist:{"href":"/artist/james-turrell"}' },
                  // However, SearchableItem objects are not normalized.
                  edge.node,
                ][i],
              })),
              pageInfo: turrellPageInfo2,
              totalCount: 13531,
            });

            // Wait a bit to make sure there are no additional results for
            // Basquiat.
            setTimeout(resolve, 100);
          });
        } else {
          reject("should not receive another result for Basquiat");
        }
      });
    });

    withErrorSpy(it, "runs nested merge functions as well as ancestors", function () {
      let eventMergeCount = 0;
      let attendeeMergeCount = 0;

      const cache = new InMemoryCache({
        typePolicies: {
          Event: {
            fields: {
              attendees: {
                merge(existing: any[], incoming: any[]) {
                  ++eventMergeCount;
                  expect(Array.isArray(incoming)).toBe(true);
                  return existing ? existing.concat(incoming) : incoming;
                },
              },
            },
          },

          Attendee: {
            fields: {
              events: {
                merge(existing: any[], incoming: any[]) {
                  ++attendeeMergeCount;
                  expect(Array.isArray(incoming)).toBe(true);
                  return existing ? existing.concat(incoming) : incoming;
                },
              },
            },
          },
        },
      });

      cache.writeQuery({
        query: gql`
          query {
            eventsToday {
              name
              attendees {
                name
                events {
                  time
                }
              }
            }
          }
        `,
        data: {
          eventsToday: [{
            __typename: "Event",
            id: 123,
            name: "One-person party",
            time: "noonish",
            attendees: [{
              __typename: "Attendee",
              id: 234,
              name: "Ben Newman",
              events: [
                { __typename: "Event", id: 123 },
              ],
            }],
          }],
        },
      });

      expect(eventMergeCount).toBe(1);
      expect(attendeeMergeCount).toBe(1);

      expect(cache.extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          eventsToday: [
            { __ref: "Event:123" },
          ],
        },
        "Event:123": {
          __typename: "Event",
          id: 123,
          name: "One-person party",
          attendees: [
            { __ref: "Attendee:234" },
          ],
        },
        "Attendee:234": {
          __typename: "Attendee",
          id: 234,
          name: "Ben Newman",
          events: [
            { __ref: "Event:123" },
          ],
        },
      });

      cache.writeQuery({
        query: gql`
          query {
            people {
              name
              events {
                time
                attendees {
                  name
                }
              }
            }
          }
        `,
        data: {
          people: [{
            __typename: "Attendee",
            id: 234,
            name: "Ben Newman",
            events: [{
              __typename: "Event",
              id: 345,
              name: "Rooftop dog party",
              attendees: [{
                __typename: "Attendee",
                id: 456,
                name: "Inspector Beckett",
              }, {
                __typename: "Attendee",
                id: 234,
              }],
            }],
          }],
        },
      });

      expect(eventMergeCount).toBe(2);
      expect(attendeeMergeCount).toBe(2);

      expect(cache.extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          eventsToday: [
            { __ref: "Event:123" },
          ],
          people: [
            { __ref: "Attendee:234" },
          ],
        },
        "Event:123": {
          __typename: "Event",
          id: 123,
          name: "One-person party",
          attendees: [
            { __ref: "Attendee:234" },
          ],
        },
        "Event:345": {
          __typename: "Event",
          id: 345,
          attendees: [
            { __ref: "Attendee:456" },
            { __ref: "Attendee:234" },
          ],
        },
        "Attendee:234": {
          __typename: "Attendee",
          id: 234,
          name: "Ben Newman",
          events: [
            { __ref: "Event:123" },
            { __ref: "Event:345" },
          ],
        },
        "Attendee:456": {
          __typename: "Attendee",
          id: 456,
          name: "Inspector Beckett",
        },
      });

      expect(cache.gc()).toEqual([]);
    });

    it("should report dangling references returned by read functions", function () {
      const cache = new InMemoryCache({
        typePolicies: {
          Query: {
            fields: {
              book: {
                keyArgs: ["isbn"],
                read(existing, { args, toReference }) {
                  return existing || toReference({
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
        query {
          book(isbn: $isbn) {
            title
            author
          }
        }
      `;

      function read(isbn = "156858217X") {
        return cache.readQuery({
          query,
          variables: { isbn },
        });
      }

      function diff(isbn = "156858217X") {
        return cache.diff({
          query,
          variables: { isbn },
          returnPartialData: false,
          optimistic: true,
        });
      }

      expect(read()).toBe(null);

      cache.writeQuery({
        query,
        variables: { isbn: "0393354326" },
        data: {
          book: {
            __typename: "Book",
            isbn: "0393354326",
            title: "Guns, Germs, and Steel",
            author: "Jared Diamond",
          },
        },
      });

      expect(read()).toBe(null);

      expect(diff).toThrow(
        /Dangling reference to missing Book:{"isbn":"156858217X"} object/,
      );

      const stealThisData = {
        __typename: "Book",
        isbn: "156858217X",
        title: "Steal This Book",
        author: "Abbie Hoffman",
      };

      const stealThisID = cache.identify(stealThisData)!;

      cache.writeFragment({
        id: stealThisID,
        fragment: gql`
          fragment BookTitleAuthor on Book {
            title
            author
          }
        `,
        data: stealThisData,
      });

      expect(read()).toEqual({
        book: {
          __typename: "Book",
          title: "Steal This Book",
          author: "Abbie Hoffman",
        },
      });

      expect(read("0393354326")).toEqual({
        book: {
          __typename: "Book",
          title: "Guns, Germs, and Steel",
          author: "Jared Diamond",
        },
      });

      expect(cache.extract()).toEqual({
        __META: {
          extraRootIds: [
            'Book:{"isbn":"156858217X"}',
          ],
        },
        ROOT_QUERY: {
          __typename: "Query",
          'book:{"isbn":"0393354326"}': {
            __ref: 'Book:{"isbn":"0393354326"}',
          },
        },
        'Book:{"isbn":"0393354326"}': {
          __typename: "Book",
          isbn: "0393354326",
          author: "Jared Diamond",
          title: "Guns, Germs, and Steel",
        },
        'Book:{"isbn":"156858217X"}': {
          __typename: "Book",
          isbn: "156858217X",
          author: "Abbie Hoffman",
          title: "Steal This Book",
        },
      });

      // Nothing removed because stealThisID was retained by writeFragment.
      expect(cache.gc()).toEqual([]);
      expect(cache.release(stealThisID)).toBe(0);
      expect(cache.gc()).toEqual([
        stealThisID,
      ]);

      expect(cache.extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          'book:{"isbn":"0393354326"}': {
            __ref: 'Book:{"isbn":"0393354326"}',
          },
        },
        'Book:{"isbn":"0393354326"}': {
          __typename: "Book",
          isbn: "0393354326",
          author: "Jared Diamond",
          title: "Guns, Germs, and Steel",
        },
      });

      cache.writeQuery({
        query,
        variables: { isbn: "156858217X" },
        data: {
          book: stealThisData,
        },
      });

      expect(cache.extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          'book:{"isbn":"0393354326"}': {
            __ref: 'Book:{"isbn":"0393354326"}',
          },
          'book:{"isbn":"156858217X"}': {
            __ref: 'Book:{"isbn":"156858217X"}',
          },
        },
        'Book:{"isbn":"0393354326"}': {
          __typename: "Book",
          isbn: "0393354326",
          author: "Jared Diamond",
          title: "Guns, Germs, and Steel",
        },
        'Book:{"isbn":"156858217X"}': {
          __typename: "Book",
          isbn: "156858217X",
          author: "Abbie Hoffman",
          title: "Steal This Book",
        },
      });

      expect(cache.gc()).toEqual([]);

      expect(cache.evict({
        fieldName: "book",
      })).toBe(true);

      expect(cache.gc().sort()).toEqual([
        'Book:{"isbn":"0393354326"}',
        'Book:{"isbn":"156858217X"}',
      ]);

      expect(cache.extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
        },
      });

      expect(read("0393354326")).toBe(null);
      expect(() => diff("0393354326")).toThrow(
        /Dangling reference to missing Book:{"isbn":"0393354326"} object/
      );

      expect(read("156858217X")).toBe(null);
      expect(() => diff("156858217X")).toThrow(
        /Dangling reference to missing Book:{"isbn":"156858217X"} object/
      );
    });

    it("can force merging of unidentified non-normalized data", function () {
      const cache = new InMemoryCache({
        typePolicies: {
          Book: {
            keyFields: ["isbn"],
            fields: {
              author: {
                merge(existing: StoreObject, incoming: StoreObject, { mergeObjects }) {
                  expect(mergeObjects(void 0 as any, null)).toBe(null);

                  expect(() => {
                    // The type system does a pretty good job of defending
                    // against this mistake.
                    mergeObjects([1, 2, 3] as any as StoreObject, [4] as any as StoreObject);
                  }).toThrow(/Cannot automatically merge arrays/);

                  const a = { __typename: "A", a: "ay" };
                  const b = { __typename: "B", a: "bee" };
                  expect(mergeObjects(a, b)).toBe(b);
                  expect(mergeObjects(b, a)).toBe(a);

                  return mergeObjects(existing, incoming);
                },
              },
            },
          },

          Author: {
            keyFields: false,
            fields: {
              books: booksMergePolicy(),
            },
          },
        },
      });

      testForceMerges(cache);
    });

    function booksMergePolicy(): FieldPolicy<any[]> {
      return {
        merge(existing, incoming, {
          isReference,
        }) {
          const merged = existing ? existing.slice(0) : [];
          const seen = new Set<string>();
          if (existing) {
            existing.forEach(book => {
              if (isReference(book)) {
                seen.add(book.__ref);
              }
            });
          }
          incoming.forEach(book => {
            if (isReference(book)) {
              if (!seen.has(book.__ref)) {
                merged.push(book);
                seen.add(book.__ref);
              }
            } else {
              merged.push(book);
            }
          });
          return merged;
        },
      };
    }

    function testForceMerges(cache: InMemoryCache) {
      const queryWithAuthorName = gql`
        query {
          currentlyReading {
            isbn
            title
            author {
              name
            }
          }
        }
      `;

      const queryWithAuthorBooks = gql`
        query {
          currentlyReading {
            isbn
            author {
              books {
                isbn
                title
              }
            }
          }
        }
      `;

      cache.writeQuery({
        query: queryWithAuthorName,
        data: {
          currentlyReading: {
            __typename: "Book",
            isbn: "1250758009",
            title: "The Topeka School",
            author: {
              __typename: "Author",
              name: "Ben Lerner",
            },
          },
        },
      });

      expect(cache.extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          currentlyReading: {
            __ref: 'Book:{"isbn":"1250758009"}',
          },
        },
        'Book:{"isbn":"1250758009"}': {
          __typename: "Book",
          author: {
            __typename: "Author",
            name: "Ben Lerner",
          },
          isbn: "1250758009",
          title: "The Topeka School",
        },
      });

      cache.writeQuery({
        query: queryWithAuthorBooks,
        data: {
          currentlyReading: {
            __typename: "Book",
            isbn: "1250758009",
            author: {
              __typename: "Author",
              books: [{
                __typename: "Book",
                isbn: "1250758009",
                title: "The Topeka School",
              }],
            },
          },
        },
      });

      expect(cache.extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          currentlyReading: {
            __ref: 'Book:{"isbn":"1250758009"}',
          },
        },
        'Book:{"isbn":"1250758009"}': {
          __typename: "Book",
          author: {
            __typename: "Author",
            name: "Ben Lerner",
            books: [
              { __ref: 'Book:{"isbn":"1250758009"}' },
            ],
          },
          isbn: "1250758009",
          title: "The Topeka School",
        },
      });

      cache.writeQuery({
        query: queryWithAuthorBooks,
        data: {
          currentlyReading: {
            __typename: "Book",
            isbn: "1250758009",
            author: {
              __typename: "Author",
              books: [{
                __typename: "Book",
                isbn: "1566892740",
                title: "Leaving the Atocha Station",
              }],
            },
          },
        },
      });

      expect(cache.extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          currentlyReading: {
            __ref: 'Book:{"isbn":"1250758009"}',
          },
        },
        'Book:{"isbn":"1250758009"}': {
          __typename: "Book",
          author: {
            __typename: "Author",
            name: "Ben Lerner",
            books: [
              { __ref: 'Book:{"isbn":"1250758009"}' },
              { __ref: 'Book:{"isbn":"1566892740"}' },
            ],
          },
          isbn: "1250758009",
          title: "The Topeka School",
        },
        'Book:{"isbn":"1566892740"}': {
          __typename: "Book",
          isbn: "1566892740",
          title: "Leaving the Atocha Station",
        },
      });

      expect(cache.readQuery({
        query: queryWithAuthorBooks,
      })).toEqual({
        currentlyReading: {
          __typename: "Book",
          isbn: "1250758009",
          author: {
            __typename: "Author",
            books: [{
              __typename: "Book",
              isbn: "1250758009",
              title: "The Topeka School",
            }, {
              __typename: "Book",
              isbn: "1566892740",
              title: "Leaving the Atocha Station",
            }],
          },
        },
      });

      expect(cache.readQuery({
        query: queryWithAuthorName,
      })).toEqual({
        currentlyReading: {
          __typename: "Book",
          isbn: "1250758009",
          title: "The Topeka School",
          author: {
            __typename: "Author",
            name: "Ben Lerner",
          },
        },
      });
    }

    // Same as previous test, except with merge:true for Book.author.
    it("can force merging with merge:true field policy", function () {
      const cache = new InMemoryCache({
        typePolicies: {
          Book: {
            keyFields: ["isbn"],
            fields: {
              author: {
                merge: true,
              },
            },
          },

          Author: {
            keyFields: false,
            fields: {
              books: booksMergePolicy(),
            },
          },
        },
      });

      testForceMerges(cache);
    });

    // Same as previous test, except configuring merge:true for the Author
    // type instead of for the Book.author field.
    it("can force merging with merge:true type policy", function () {
      const cache = new InMemoryCache({
        typePolicies: {
          Book: {
            keyFields: ["isbn"],
          },

          Author: {
            keyFields: false,
            merge: true,
            fields: {
              books: booksMergePolicy(),
            },
          },
        },
      });

      testForceMerges(cache);
    });

    it("can force merging with inherited merge:true field policy", function () {
      const cache = new InMemoryCache({
        typePolicies: {
          Authored: {
            fields: {
              author: {
                merge: true,
              },
            },
          },

          Book: {
            keyFields: ["isbn"],
          },

          Author: {
            keyFields: false,
            fields: {
              books: booksMergePolicy(),
            },
          },
        },

        possibleTypes: {
          Authored: ["Book", "Destruction"],
        },
      });

      testForceMerges(cache);
    });

    it("can force merging with inherited merge:true type policy", function () {
      const cache = new InMemoryCache({
        typePolicies: {
          Book: {
            keyFields: ["isbn"],
          },

          Author: {
            fields: {
              books: booksMergePolicy(),
            },
          },

          Person: {
            keyFields: false,
            merge: true,
          },
        },

        possibleTypes: {
          Person: ["Author"],
        },
      });

      testForceMerges(cache);
    });

    function checkAuthor<TData>(data: TData, canBeUndefined = false) {
      if (data || !canBeUndefined) {
        expect(data).toBeTruthy();
        expect(typeof data).toBe("object");
        expect((data as any).__typename).toBe("Author");
      }
      return data;
    }

    it("can force merging with inherited type policy merge function", function () {
      let personMergeCount = 0;

      const cache = new InMemoryCache({
        typePolicies: {
          Book: {
            keyFields: ["isbn"],
          },

          Author: {
            fields: {
              books: booksMergePolicy(),
            },
          },

          Person: {
            keyFields: false,

            merge(existing, incoming) {
              checkAuthor(existing, true);
              checkAuthor(incoming);
              ++personMergeCount;
              return { ...existing, ...incoming };
            },
          },
        },

        possibleTypes: {
          Person: ["Author"],
        },
      });

      testForceMerges(cache);

      expect(personMergeCount).toBe(3);
    });

    it("can force merging references with non-normalized objects", function () {
      const nameQuery = gql`
        query GetName {
          viewer {
            name
          }
        }
      `;

      const emailQuery = gql`
        query GetEmail {
          viewer {
            id
            email
          }
        }
      `;

      check(new InMemoryCache({
        typePolicies: {
          Query: {
            fields: {
              viewer: {
                merge: true,
              },
            },
          },
        },
      }));

      check(new InMemoryCache({
        typePolicies: {
          User: {
            merge: true,
          },
        },
      }));

      function check(cache: InMemoryCache) {
        // Write nameQuery first, so the existing data will be a
        // non-normalized object when we write emailQuery next.
        cache.writeQuery({
          query: nameQuery,
          data: {
            viewer: {
              __typename: "User",
              name: "Alice",
            },
          },
        });

        expect(cache.extract()).toEqual({
          ROOT_QUERY: {
            __typename: "Query",
            viewer: {
              __typename: "User",
              name: "Alice",
            },
          },
        });

        cache.writeQuery({
          query: emailQuery,
          data: {
            viewer: {
              __typename: "User",
              id: 12345,
              email: "alice@example.com",
            },
          },
        });

        expect(cache.extract()).toEqual({
          ROOT_QUERY: {
            __typename: "Query",
            viewer: {
              __ref: "User:12345",
            },
          },
          "User:12345": {
            __typename: "User",
            name: "Alice",
            id: 12345,
            email: "alice@example.com",
          },
        });

        expect(cache.readQuery({
          query: nameQuery,
        })).toEqual({
          viewer: {
            __typename: "User",
            name: "Alice",
          },
        });

        expect(cache.readQuery({
          query: emailQuery,
        })).toEqual({
          viewer: {
            __typename: "User",
            id: 12345,
            email: "alice@example.com",
          },
        });

        cache.reset();
        expect(cache.extract()).toEqual({});

        // Write emailQuery first, so the existing data will be a
        // normalized reference when we write nameQuery next.
        cache.writeQuery({
          query: emailQuery,
          data: {
            viewer: {
              __typename: "User",
              id: 12345,
              email: "alice@example.com",
            },
          },
        });

        expect(cache.extract()).toEqual({
          "User:12345": {
            id: 12345,
            __typename: "User",
            email: "alice@example.com"
          },
          ROOT_QUERY: {
            __typename: "Query",
            viewer: {
              __ref: "User:12345",
            },
          },
        });

        cache.writeQuery({
          query: nameQuery,
          data: {
            viewer: {
              __typename: "User",
              name: "Alice",
            },
          },
        });

        expect(cache.extract()).toEqual({
          "User:12345": {
            id: 12345,
            __typename: "User",
            email: "alice@example.com",
            name: "Alice",
          },
          ROOT_QUERY: {
            __typename: "Query",
            viewer: {
              __ref: "User:12345",
            },
          },
        });

        expect(cache.readQuery({
          query: nameQuery,
        })).toEqual({
          viewer: {
            __typename: "User",
            name: "Alice",
          },
        });

        expect(cache.readQuery({
          query: emailQuery,
        })).toEqual({
          viewer: {
            __typename: "User",
            id: 12345,
            email: "alice@example.com",
          },
        });
      }
    });

    it("can force merging with inherited field merge function", function () {
      let authorMergeCount = 0;

      const cache = new InMemoryCache({
        typePolicies: {
          Book: {
            keyFields: ["isbn"],
          },

          Authored: {
            fields: {
              author: {
                merge(existing, incoming) {
                  checkAuthor(existing, true);
                  checkAuthor(incoming);
                  ++authorMergeCount;
                  return { ...existing, ...incoming };
                },
              },
            },
          },


          Author: {
            fields: {
              books: booksMergePolicy(),
            },
          },

          Person: {
            keyFields: false,
          },
        },

        possibleTypes: {
          Authored: ["Destiny", "Book"],
          Person: ["Author"],
        },
      });

      testForceMerges(cache);

      expect(authorMergeCount).toBe(3);
    });
  });

  it("runs read and merge functions for unidentified data", function () {
    const cache = new InMemoryCache({
      typePolicies: {
        Book: {
          keyFields: ["isbn"],
        },

        Author: {
          // Passing false for keyFields disables normalization of Author
          // objects, which should not interfere with the operation of
          // their read and/or merge functions. However, disabling
          // normalization means the merge function for the name field
          // will be called only once, because we never merge fields when
          // the IDs of the enclosing objects are unknown or unequal.
          keyFields: false,

          fields: {
            name: {
              read(name: string) {
                return reverse(name).toUpperCase();
              },
              merge(oldName, newName: string) {
                expect(oldName).toBe(void 0);
                expect(typeof newName).toBe("string");
                return reverse(newName);
              },
            },
          },
        },
      },
    });

    const query = gql`
      query {
        currentlyReading {
          title
          authors {
            name
          }
        }
      }
    `;

    cache.writeQuery({
      query,
      data: {
        currentlyReading: [{
          __typename: "Book",
          isbn: "0525558616",
          title: "Human Compatible: Artificial Intelligence and the Problem of Control",
          authors: [{
            __typename: "Author",
            name: "Stuart Russell",
          }],
        }, {
          __typename: "Book",
          isbn: "1541698967",
          title: "The Book of Why: The New Science of Cause and Effect",
          authors: [{
            __typename: "Author",
            name: "Judea Pearl",
          }, {
            __typename: "Author",
            name: "Dana Mackenzie",
          }],
        }],
      },
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        currentlyReading: [
          { __ref: 'Book:{"isbn":"0525558616"}' },
          { __ref: 'Book:{"isbn":"1541698967"}' },
        ],
      },
      'Book:{"isbn":"0525558616"}': {
        __typename: "Book",
        isbn: "0525558616",
        authors: [{
          __typename: "Author",
          // Note the successful reversal of the Author names.
          name: "llessuR trautS",
        }],
        title: "Human Compatible: Artificial Intelligence and the Problem of Control",
      },
      'Book:{"isbn":"1541698967"}': {
        __typename: "Book",
        isbn: "1541698967",
        authors: [{
          __typename: "Author",
          name: "lraeP aeduJ",
        }, {
          __typename: "Author",
          name: "eiznekcaM anaD",
        }],
        title: "The Book of Why: The New Science of Cause and Effect",
      },
    });

    expect(cache.readQuery({ query })).toEqual({
      currentlyReading: [{
        __typename: "Book",
        title: "Human Compatible: Artificial Intelligence and the Problem of Control",
        authors: [{
          __typename: "Author",
          name: "STUART RUSSELL",
        }],
      }, {
        __typename: "Book",
        title: "The Book of Why: The New Science of Cause and Effect",
        authors: [{
          __typename: "Author",
          // Note the successful re-reversal and uppercasing, thanks to
          // the custom read function.
          name: "JUDEA PEARL",
        }, {
          __typename: "Author",
          name: "DANA MACKENZIE",
        }],
      }],
    });
  });

  it("allows keyFields and keyArgs functions to return false", function () {
    const cache = new InMemoryCache({
      typePolicies: {
        Person: {
          keyFields() {
            return false;
          },
          fields: {
            height: {
              keyArgs() {
                return false;
              },
              merge(_, height, { args }) {
                if (args) {
                  if (args.units === "feet") {
                    return height;
                  }
                  if (args.units === "meters") {
                    // Convert to feet so we don't have to remember the units.
                    return height * 3.28084;
                  }
                }
                throw new Error("unexpected units: " + args);
              },
            },
          },
        },
      },
    });

    const query = gql`
      query GetUser ($units: string) {
        people {
          id
          height(units: $units)
        }
      }
    `;

    cache.writeQuery({
      query,
      variables: {
        units: "meters",
      },
      data: {
        people: [{
          __typename: "Person",
          id: 12345,
          height: 1.75,
        }, {
          __typename: "Person",
          id: 23456,
          height: 2,
        }],
      },
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        // An array of non-normalized objects, not Reference objects.
        people: [{
          __typename: "Person",
          // No serialized units argument, just "height".
          height: 5.74147,
          id: 12345,
        }, {
          __typename: "Person",
          height: 6.56168,
          id: 23456,
        }],
      },
    });
  });

  it("can read from foreign references using read helper", function () {
    const cache = new InMemoryCache({
      typePolicies: {
        Author: {
          keyFields: ["name"],

          fields: {
            books: {
              merge(existing: Reference[] = [], incoming: Reference[]) {
                return [...existing, ...incoming];
              },
            },

            // A dynamically computed field that returns the Book
            // Reference with the earliest year, which requires reading
            // fields from foreign references.
            firstBook(_, { isReference, readField }) {
              let firstBook: Reference | null = null;
              let firstYear: number;
              const bookRefs = readField<Reference[]>("books") || [];
              bookRefs.forEach(bookRef => {
                expect(isReference(bookRef)).toBe(true);
                const year = readField<number>("year", bookRef);
                if (firstYear === void 0 || year! < firstYear) {
                  firstBook = bookRef;
                  firstYear = year!;
                }
              });
              // Return a Book Reference, which can have a nested
              // selection set applied to it.
              return firstBook;
            },
          },
        },

        Book: {
          keyFields: ["isbn"],
        },
      },
    });

    interface BookData {
      __typename: 'Book'
      isbn: string
      title: string
      year: number
    }

    function addBook(bookData: BookData) {
      cache.writeQuery({
        query: gql`
          query {
            author {
              name
              books {
                isbn
                title
                year
              }
            }
          }
        `,
        data: {
          author: {
            __typename: "Author",
            name: "Virginia Woolf",
            books: [bookData],
          },
        },
      });
    }

    addBook({
      __typename: "Book",
      isbn: "1853262390",
      title: "Orlando",
      year: 1928,
    });

    addBook({
      __typename: "Book",
      isbn: "9353420717",
      title: "A Room of One's Own",
      year: 1929,
    });

    addBook({
      __typename: "Book",
      isbn: "0156907399",
      title: "To the Lighthouse",
      year: 1927,
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        author: {
          __ref: 'Author:{"name":"Virginia Woolf"}',
        },
      },
      'Author:{"name":"Virginia Woolf"}': {
        __typename: "Author",
        name: "Virginia Woolf",
        books: [
          { __ref: 'Book:{"isbn":"1853262390"}' },
          { __ref: 'Book:{"isbn":"9353420717"}' },
          { __ref: 'Book:{"isbn":"0156907399"}' },
        ],
      },
      'Book:{"isbn":"1853262390"}': {
        __typename: "Book",
        isbn: "1853262390",
        title: "Orlando",
        year: 1928,
      },
      'Book:{"isbn":"9353420717"}': {
        __typename: "Book",
        isbn: "9353420717",
        title: "A Room of One's Own",
        year: 1929,
      },
      'Book:{"isbn":"0156907399"}': {
        __typename: "Book",
        isbn: "0156907399",
        title: "To the Lighthouse",
        year: 1927,
      },
    });

    const firstBookQuery = gql`
      query {
        author {
          name
          firstBook {
            title
            year
          }
        }
      }
    `;

    function readFirstBookResult() {
      return cache.readQuery<{ author: any }>({
        query: firstBookQuery,
      })!;
    }

    const firstBookResult = readFirstBookResult();
    expect(firstBookResult).toEqual({
      author: {
        __typename: "Author",
        name: "Virginia Woolf",
        firstBook: {
          __typename: "Book",
          title: "To the Lighthouse",
          year: 1927,
        },
      },
    });

    expect(readFirstBookResult()).toBe(firstBookResult);

    // Add an even earlier book.
    addBook({
      __typename: "Book",
      isbn: "1420959719",
      title: "The Voyage Out",
      year: 1915,
    });

    const secondFirstBookResult = readFirstBookResult();
    expect(secondFirstBookResult).not.toBe(firstBookResult);
    expect(secondFirstBookResult).toEqual({
      author: {
        __typename: "Author",
        name: "Virginia Woolf",
        firstBook: {
          __typename: "Book",
          title: "The Voyage Out",
          year: 1915,
        },
      },
    });

    // Write a new, unrelated field.
    cache.writeQuery({
      query: gql`query { author { afraidCount } }`,
      data: {
        author: {
          __typename: "Author",
          name: "Virginia Woolf",
          afraidCount: 2,
        },
      },
    });

    // Make sure afraidCount was written.
    expect(cache.readFragment({
      id: cache.identify({
        __typename: "Author",
        name: "Virginia Woolf",
      })!,
      fragment: gql`
        fragment AfraidFragment on Author {
          name
          afraidCount
        }
      `,
    })).toEqual({
      __typename: "Author",
      name: "Virginia Woolf",
      afraidCount: 2,
    });

    // Since we wrote only the afraidCount field, the firstBook result
    // should be completely unchanged.
    expect(readFirstBookResult()).toBe(secondFirstBookResult);

    // Add another book, not published first.
    addBook({
      __typename: "Book",
      isbn: "9780156949606",
      title: "The Waves",
      year: 1931,
    });

    const thirdFirstBookResult = readFirstBookResult();
    expect(thirdFirstBookResult).toEqual(secondFirstBookResult);
    expect(thirdFirstBookResult).toBe(secondFirstBookResult);
  });

  it("readField can read fields with arguments", function () {
    const enum Style { UPPER, LOWER, TITLE };

    const cache = new InMemoryCache({
      typePolicies: {
        Word: {
          keyFields: ["text"],

          fields: {
            style(_, { args, readField }) {
              const text = readField<string>("text");
              switch (args?.style) {
                case Style.UPPER: return text?.toUpperCase();
                case Style.LOWER: return text?.toLowerCase();
                case Style.TITLE:
                  return text && (
                    text.charAt(0).toUpperCase() +
                    text.slice(1).toLowerCase()
                  );
              }
            },
            upperCase(_, { readField }) {
              return readField<string>({
                fieldName: "style",
                args: { style: Style.UPPER },
              });
            },
            lowerCase(_, { readField }) {
              return readField<string>({
                fieldName: "style",
                args: { style: Style.LOWER },
              });
            },
            titleCase(_, { readField }) {
              return readField<string>({
                fieldName: "style",
                args: { style: Style.TITLE },
              });
            },
          },
        },
      },
    });

    cache.writeQuery({
      query: gql`query { wordOfTheDay { text } }`,
      data: {
        wordOfTheDay: {
          __typename: "Word",
          text: "inveigle",
        },
      },
    });

    expect(cache.readQuery({
      query: gql`
        query {
          wordOfTheDay {
            upperCase
            lowerCase
            titleCase
          }
        }
      `,
    })).toEqual({
      wordOfTheDay: {
        __typename: "Word",
        upperCase: "INVEIGLE",
        lowerCase: "inveigle",
        titleCase: "Inveigle",
      },
    });
  });

  it("can return existing object from merge function (issue #6245)", function () {
    const cache = new InMemoryCache({
      typePolicies: {
        Person: {
          fields: {
            currentTask: {
              merge(existing, incoming) {
                // Not a very reasonable merge strategy, but returning
                // existing here triggers issue #6245, persumably because
                // the existing data is frozen.
                return existing || incoming;
              },
            },
          },
        },
        Task: {
          keyFields: false,
        },
      },
    });

    const query = gql`
      query {
        person {
          currentTask {
            __typename
            description
          }
        }
      }
    `;

    cache.writeQuery({
      query,
      data: {
        person: {
          __typename: "Person",
          id: 1234,
          currentTask: {
            __typename: "Task",
            description: "writing tests",
          },
        },
      },
    });

    const snapshot = cache.extract();
    expect(snapshot).toEqual({
      "Person:1234": {
        __typename: "Person",
        id: 1234,
        currentTask: {
          __typename: "Task",
          description: "writing tests",
        },
      },
      ROOT_QUERY: {
        __typename: "Query",
        person: {
          __ref: "Person:1234",
        },
      },
    });

    cache.writeQuery({
      query,
      data: {
        person: {
          __typename: "Person",
          id: 1234,
          currentTask: {
            __typename: "Task",
            description: "polishing knives",
          },
        },
      },
    });

    // Unchanged because the merge function prefers the existing object.
    expect(cache.extract()).toEqual(snapshot);
  });

  it("can alter the root query __typename", function () {
    const cache = new InMemoryCache({
      typePolicies: {
        RootQuery: {
          queryType: true,
        },
      }
    });

    expect(cache.readQuery({
      query: gql`query { __typename }`,
    })).toEqual({
      __typename: "RootQuery",
    });

    const ALL_ITEMS = gql`
      query Items {
        __typename
        items {
          id
          query {
            id
          }
        }
      }
    `;

    function makeItem(id: number) {
      return {
        id,
        query: {
          __typename: "Query",
          id,
        },
      };
    }

    cache.writeQuery({
      query: ALL_ITEMS,
      data: {
        __typename: "RootQuery",
        items: [
          makeItem(0),
          makeItem(1),
          makeItem(2),
          makeItem(3),
        ],
      },
    });

    expect(cache.extract()).toMatchSnapshot();

    expect(cache.readQuery({
      query: ALL_ITEMS,
    })).toEqual({
      __typename: "RootQuery",
      items: [
        makeItem(0),
        makeItem(1),
        makeItem(2),
        makeItem(3),
      ],
    });
  });

  it("can configure {query,mutation,subscription}Type:true", () => {
    const cache = new InMemoryCache({
      typePolicies: {
        RootQuery: {
          queryType: true,
        },
        RootMutation: {
          mutationType: true,
        },
        RootSubscription: {
          subscriptionType: true,
        },
      }
    });

    expect(cache.readQuery({
      query: gql`query { __typename }`,
    })).toEqual({
      __typename: "RootQuery",
    });

    expect(cache.readFragment({
      id: "ROOT_MUTATION",
      fragment: gql`
        fragment MutationTypename on RootMutation {
          __typename
        }
      `,
    })).toEqual({
      __typename: "RootMutation",
    });

    expect(cache.readFragment({
      id: "ROOT_SUBSCRIPTION",
      fragment: gql`
        fragment SubscriptionTypename on RootSubscription {
          __typename
        }
      `,
    })).toEqual({
      __typename: "RootSubscription",
    });
  });
});
