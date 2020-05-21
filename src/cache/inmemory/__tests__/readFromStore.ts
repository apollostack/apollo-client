import { assign, omit } from 'lodash';
import gql from 'graphql-tag';

import { stripSymbols } from '../../../utilities/testing/stripSymbols';
import type { StoreObject } from '../types';
import { StoreReader } from '../readFromStore';
import { makeReference } from '../../../core';
import { defaultNormalizedCacheFactory } from '../entityStore';
import { withError } from './diffAgainstStore';
import { Policies } from '../policies';

describe('reading from the store', () => {
  const reader = new StoreReader({
    policies: new Policies(),
  });

  it('runs a nested query with proper fragment fields in arrays', () => {
    withError(() => {
      const store = defaultNormalizedCacheFactory({
        ROOT_QUERY: {
          __typename: 'Query',
          nestedObj: makeReference('abcde'),
        } as StoreObject,
        abcde: {
          id: 'abcde',
          innerArray: [
            {
              id: 'abcdef',
              someField: 3,
            },
          ],
        } as StoreObject,
      });

      const queryResult = reader.readQueryFromStore({
        store,
        query: gql`
          {
            ... on DummyQuery {
              nestedObj {
                innerArray {
                  id
                  otherField
                }
              }
            }
            ... on Query {
              nestedObj {
                innerArray {
                  id
                  someField
                }
              }
            }
            ... on DummyQuery2 {
              nestedObj {
                innerArray {
                  id
                  otherField2
                }
              }
            }
          }
        `,
      });

      expect(stripSymbols(queryResult)).toEqual({
        nestedObj: {
          innerArray: [{ id: 'abcdef', someField: 3 }],
        },
      });
    });
  });

  it('rejects malformed queries', () => {
    expect(() => {
      reader.readQueryFromStore({
        store: defaultNormalizedCacheFactory(),
        query: gql`
          query {
            name
          }

          query {
            address
          }
        `,
      });
    }).toThrowError(/2 operations/);

    expect(() => {
      reader.readQueryFromStore({
        store: defaultNormalizedCacheFactory(),
        query: gql`
          fragment x on y {
            name
          }
        `,
      });
    }).toThrowError(/contain a query/);
  });

  it('runs a basic query', () => {
    const result = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
    } as StoreObject;

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: result,
    });

    const queryResult = reader.readQueryFromStore({
      store,
      query: gql`
        query {
          stringField
          numberField
        }
      `,
    });

    // The result of the query shouldn't contain __data_id fields
    expect(stripSymbols(queryResult)).toEqual({
      stringField: result['stringField'],
      numberField: result['numberField'],
    });
  });

  it('runs a basic query with arguments', () => {
    const query = gql`
      query {
        id
        stringField(arg: $stringArg)
        numberField(intArg: $intArg, floatArg: $floatArg)
        nullField
      }
    `;

    const variables = {
      intArg: 5,
      floatArg: 3.14,
      stringArg: 'This is a string!',
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: {
        id: 'abcd',
        nullField: null,
        'numberField({"floatArg":3.14,"intArg":5})': 5,
        'stringField({"arg":"This is a string!"})': 'Heyo',
      },
    });

    const result = reader.readQueryFromStore({
      store,
      query,
      variables,
    });

    expect(stripSymbols(result)).toEqual({
      id: 'abcd',
      nullField: null,
      numberField: 5,
      stringField: 'Heyo',
    });
  });

  it('runs a basic query with custom directives', () => {
    const query = gql`
      query {
        id
        firstName @include(if: true)
        lastName @upperCase
        birthDate @dateFormat(format: "DD-MM-YYYY")
      }
    `;

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: {
        id: 'abcd',
        firstName: 'James',
        'lastName@upperCase': 'BOND',
        'birthDate@dateFormat({"format":"DD-MM-YYYY"})': '20-05-1940',
      },
    });

    const result = reader.readQueryFromStore({
      store,
      query,
    });

    expect(stripSymbols(result)).toEqual({
      id: 'abcd',
      firstName: 'James',
      lastName: 'BOND',
      birthDate: '20-05-1940',
    });
  });

  it('runs a basic query with default values for arguments', () => {
    const query = gql`
      query someBigQuery(
        $stringArg: String = "This is a default string!"
        $intArg: Int = 0
        $floatArg: Float
      ) {
        id
        stringField(arg: $stringArg)
        numberField(intArg: $intArg, floatArg: $floatArg)
        nullField
      }
    `;

    const variables = {
      floatArg: 3.14,
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: {
        id: 'abcd',
        nullField: null,
        'numberField({"floatArg":3.14,"intArg":0})': 5,
        'stringField({"arg":"This is a default string!"})': 'Heyo',
      },
    });

    const result = reader.readQueryFromStore({
      store,
      query,
      variables,
    });

    expect(stripSymbols(result)).toEqual({
      id: 'abcd',
      nullField: null,
      numberField: 5,
      stringField: 'Heyo',
    });
  });

  it('runs a nested query', () => {
    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedObj: {
        id: 'abcde',
        stringField: 'This is a string too!',
        numberField: 6,
        nullField: null,
      } as StoreObject,
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: assign({}, assign({}, omit(result, 'nestedObj')), {
        nestedObj: makeReference('abcde'),
      } as StoreObject),
      abcde: result.nestedObj,
    });

    const queryResult = reader.readQueryFromStore({
      store,
      query: gql`
        {
          stringField
          numberField
          nestedObj {
            stringField
            numberField
          }
        }
      `,
    });

    // The result of the query shouldn't contain __data_id fields
    expect(stripSymbols(queryResult)).toEqual({
      stringField: 'This is a string!',
      numberField: 5,
      nestedObj: {
        stringField: 'This is a string too!',
        numberField: 6,
      },
    });
  });

  it('runs a nested query with multiple fragments', () => {
    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedObj: {
        id: 'abcde',
        stringField: 'This is a string too!',
        numberField: 6,
        nullField: null,
      } as StoreObject,
      deepNestedObj: {
        stringField: 'This is a deep string',
        numberField: 7,
        nullField: null,
      } as StoreObject,
      nullObject: null,
      __typename: 'Item',
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: assign(
        {},
        assign({}, omit(result, 'nestedObj', 'deepNestedObj')),
        {
          __typename: 'Query',
          nestedObj: makeReference('abcde'),
        } as StoreObject,
      ),
      abcde: assign({}, result.nestedObj, {
        deepNestedObj: makeReference('abcdef'),
      }) as StoreObject,
      abcdef: result.deepNestedObj as StoreObject,
    });

    const queryResult = reader.readQueryFromStore({
      store,
      query: gql`
        {
          stringField
          numberField
          nullField
          ... on Query {
            nestedObj {
              stringField
              nullField
              deepNestedObj {
                stringField
                nullField
              }
            }
          }
          ... on Query {
            nestedObj {
              numberField
              nullField
              deepNestedObj {
                numberField
                nullField
              }
            }
          }
          ... on Query {
            nullObject
          }
        }
      `,
    });

    // The result of the query shouldn't contain __data_id fields
    expect(stripSymbols(queryResult)).toEqual({
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedObj: {
        stringField: 'This is a string too!',
        numberField: 6,
        nullField: null,
        deepNestedObj: {
          stringField: 'This is a deep string',
          numberField: 7,
          nullField: null,
        },
      },
      nullObject: null,
    });
  });

  it('runs a nested query with an array without IDs', () => {
    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedArray: [
        {
          stringField: 'This is a string too!',
          numberField: 6,
          nullField: null,
        },
        {
          stringField: 'This is a string also!',
          numberField: 7,
          nullField: null,
        },
      ] as StoreObject[],
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: result,
    });

    const queryResult = reader.readQueryFromStore({
      store,
      query: gql`
        {
          stringField
          numberField
          nestedArray {
            stringField
            numberField
          }
        }
      `,
    });

    // The result of the query shouldn't contain __data_id fields
    expect(stripSymbols(queryResult)).toEqual({
      stringField: 'This is a string!',
      numberField: 5,
      nestedArray: [
        {
          stringField: 'This is a string too!',
          numberField: 6,
        },
        {
          stringField: 'This is a string also!',
          numberField: 7,
        },
      ],
    });
  });

  it('runs a nested query with an array without IDs and a null', () => {
    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedArray: [
        null,
        {
          stringField: 'This is a string also!',
          numberField: 7,
          nullField: null,
        },
      ] as StoreObject[],
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: result,
    });

    const queryResult = reader.readQueryFromStore({
      store,
      query: gql`
        {
          stringField
          numberField
          nestedArray {
            stringField
            numberField
          }
        }
      `,
    });

    // The result of the query shouldn't contain __data_id fields
    expect(stripSymbols(queryResult)).toEqual({
      stringField: 'This is a string!',
      numberField: 5,
      nestedArray: [
        null,
        {
          stringField: 'This is a string also!',
          numberField: 7,
        },
      ],
    });
  });

  it('runs a nested query with an array with IDs and a null', () => {
    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedArray: [
        null,
        {
          id: 'abcde',
          stringField: 'This is a string also!',
          numberField: 7,
          nullField: null,
        },
      ] as StoreObject[],
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: assign({}, assign({}, omit(result, 'nestedArray')), {
        nestedArray: [null, makeReference('abcde')],
      }) as StoreObject,
      abcde: result.nestedArray[1],
    });

    const queryResult = reader.readQueryFromStore({
      store,
      query: gql`
        {
          stringField
          numberField
          nestedArray {
            id
            stringField
            numberField
          }
        }
      `,
    });

    // The result of the query shouldn't contain __data_id fields
    expect(stripSymbols(queryResult)).toEqual({
      stringField: 'This is a string!',
      numberField: 5,
      nestedArray: [
        null,
        {
          id: 'abcde',
          stringField: 'This is a string also!',
          numberField: 7,
        },
      ],
    });
  });

  it('throws on a missing field', () => {
    const result = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
    } as StoreObject;

    const store = defaultNormalizedCacheFactory({ ROOT_QUERY: result });

    expect(() => {
      reader.readQueryFromStore({
        store,
        query: gql`
          {
            stringField
            missingField
          }
        `,
      });
    }).toThrowError(/Can't find field 'missingField' on ROOT_QUERY object/);
  });

  it('runs a nested query where the reference is null', () => {
    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedObj: null,
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: assign({}, assign({}, omit(result, 'nestedObj')), {
        nestedObj: null,
      }) as StoreObject,
    });

    const queryResult = reader.readQueryFromStore({
      store,
      query: gql`
        {
          stringField
          numberField
          nestedObj {
            stringField
            numberField
          }
        }
      `,
    });

    // The result of the query shouldn't contain __data_id fields
    expect(stripSymbols(queryResult)).toEqual({
      stringField: 'This is a string!',
      numberField: 5,
      nestedObj: null,
    });
  });

  it('runs an array of non-objects', () => {
    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      simpleArray: ['one', 'two', 'three'],
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: result,
    });

    const queryResult = reader.readQueryFromStore({
      store,
      query: gql`
        {
          stringField
          numberField
          simpleArray
        }
      `,
    });

    // The result of the query shouldn't contain __data_id fields
    expect(stripSymbols(queryResult)).toEqual({
      stringField: 'This is a string!',
      numberField: 5,
      simpleArray: ['one', 'two', 'three'],
    });
  });

  it('runs an array of non-objects with null', () => {
    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      simpleArray: [null, 'two', 'three'],
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: result,
    });

    const queryResult = reader.readQueryFromStore({
      store,
      query: gql`
        {
          stringField
          numberField
          simpleArray
        }
      `,
    });

    // The result of the query shouldn't contain __data_id fields
    expect(stripSymbols(queryResult)).toEqual({
      stringField: 'This is a string!',
      numberField: 5,
      simpleArray: [null, 'two', 'three'],
    });
  });

  it('will read from an arbitrary root id', () => {
    const data: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedObj: {
        id: 'abcde',
        stringField: 'This is a string too!',
        numberField: 6,
        nullField: null,
      } as StoreObject,
      deepNestedObj: {
        stringField: 'This is a deep string',
        numberField: 7,
        nullField: null,
      } as StoreObject,
      nullObject: null,
      __typename: 'Item',
    };

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: assign(
        {},
        assign({}, omit(data, 'nestedObj', 'deepNestedObj')),
        {
          __typename: 'Query',
          nestedObj: makeReference('abcde'),
        },
      ) as StoreObject,
      abcde: assign({}, data.nestedObj, {
        deepNestedObj: makeReference('abcdef'),
      }) as StoreObject,
      abcdef: data.deepNestedObj as StoreObject,
    });

    const queryResult1 = reader.readQueryFromStore({
      store,
      rootId: 'abcde',
      query: gql`
        {
          stringField
          numberField
          nullField
          deepNestedObj {
            stringField
            numberField
            nullField
          }
        }
      `,
    });

    expect(stripSymbols(queryResult1)).toEqual({
      stringField: 'This is a string too!',
      numberField: 6,
      nullField: null,
      deepNestedObj: {
        stringField: 'This is a deep string',
        numberField: 7,
        nullField: null,
      },
    });

    const queryResult2 = reader.readQueryFromStore({
      store,
      rootId: 'abcdef',
      query: gql`
        {
          stringField
          numberField
          nullField
        }
      `,
    });

    expect(stripSymbols(queryResult2)).toEqual({
      stringField: 'This is a deep string',
      numberField: 7,
      nullField: null,
    });
  });

  it('properly handles the @connection directive', () => {
    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: {
        'books:abc': [
          {
            name: 'efgh',
          },
        ],
      },
    });

    const queryResult = reader.readQueryFromStore({
      store,
      query: gql`
        {
          books(skip: 0, limit: 2) @connection(key: "abc") {
            name
          }
        }
      `,
    });

    expect(stripSymbols(queryResult)).toEqual({
      books: [
        {
          name: 'efgh',
        },
      ],
    });
  });

  it('can use keyArgs function instead of @connection directive', () => {
    const reader = new StoreReader({
      policies: new Policies({
        typePolicies: {
          Query: {
            fields: {
              books: {
                // Even though we're returning an arbitrary string here,
                // the InMemoryCache will ensure the actual key begins
                // with "books".
                keyArgs: () => "abc",
              },
            },
          },
        },
      }),
    });

    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: {
        "books:abc": [
          {
            name: 'efgh',
          },
        ],
      },
    });

    const queryResult = reader.readQueryFromStore({
      store,
      query: gql`
        {
          books(skip: 0, limit: 2) {
            name
          }
        }
      `,
    });

    expect(stripSymbols(queryResult)).toEqual({
      books: [
        {
          name: 'efgh',
        },
      ],
    });
  });

  it('refuses to return raw Reference objects', () => {
    const store = defaultNormalizedCacheFactory({
      ROOT_QUERY: {
        author: {
          __typename: 'Author',
          name: 'Toni Morrison',
          books: [
            {
              title: 'The Bluest Eye',
              publisher: makeReference('Publisher1'),
            },
            {
              title: 'Song of Solomon',
              publisher: makeReference('Publisher2'),
            },
            {
              title: 'Beloved',
              publisher: makeReference('Publisher2'),
            },
          ],
        },
      },
      Publisher1: {
        __typename: 'Publisher',
        id: 1,
        name: 'Holt, Rinehart and Winston',
      },
      Publisher2: {
        __typename: 'Publisher',
        id: 2,
        name: 'Alfred A. Knopf, Inc.',
      },
    });

    expect(() => {
      reader.readQueryFromStore({
        store,
        query: gql`
          {
            author {
              name
              books
            }
          }
        `,
      });
    }).toThrow(
      /Missing selection set for object of type Publisher returned for query field books/,
    );

    expect(
      reader.readQueryFromStore({
        store,
        query: gql`
          {
            author {
              name
              books {
                title
                publisher {
                  name
                }
              }
            }
          }
        `,
      }),
    ).toEqual({
      author: {
        __typename: 'Author',
        name: 'Toni Morrison',
        books: [
          {
            title: 'The Bluest Eye',
            publisher: {
              __typename: 'Publisher',
              name: 'Holt, Rinehart and Winston',
            },
          },
          {
            title: 'Song of Solomon',
            publisher: {
              __typename: 'Publisher',
              name: 'Alfred A. Knopf, Inc.',
            },
          },
          {
            title: 'Beloved',
            publisher: {
              __typename: 'Publisher',
              name: 'Alfred A. Knopf, Inc.',
            },
          },
        ],
      },
    });
  });
});
