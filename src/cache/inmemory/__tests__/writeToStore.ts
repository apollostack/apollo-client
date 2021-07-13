import { assign, omit } from 'lodash';
import {
  SelectionNode,
  FieldNode,
  DefinitionNode,
  OperationDefinitionNode,
  ASTNode,
  DocumentNode,
} from 'graphql';
import gql from 'graphql-tag';

import {
  storeKeyNameFromField,
  makeReference,
  isReference,
} from '../../../utilities/graphql/storeUtils';
import { addTypenameToDocument } from '../../../utilities/graphql/transform';
import { cloneDeep } from '../../../utilities/common/cloneDeep';
import { itAsync } from '../../../utilities/testing/itAsync';
import { StoreWriter } from '../writeToStore';
import { defaultNormalizedCacheFactory, writeQueryToStore } from './helpers';
import { InMemoryCache } from '../inMemoryCache';
import { withErrorSpy } from '../../../testing';

const getIdField = ({ id }: { id: string }) => id;

describe('writing to the store', () => {
  const cache = new InMemoryCache({
    dataIdFromObject(object: any) {
      if (object.__typename && object.id) {
        return object.__typename + '__' + object.id;
      }
    },
  });

  const writer = new StoreWriter(cache);

  it('properly normalizes a trivial item', () => {
    const query = gql`
      {
        id
        stringField
        numberField
        nullField
      }
    `;

    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
    };

    expect(
      writeQueryToStore({
        writer,
        query,
        result: cloneDeep(result),
      }).toObject(),
    ).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
        ...result,
      },
    });
  });

  it('properly normalizes an aliased field', () => {
    const query = gql`
      {
        id
        aliasedField: stringField
        numberField
        nullField
      }
    `;

    const result: any = {
      id: 'abcd',
      aliasedField: 'This is a string!',
      numberField: 5,
      nullField: null,
    };

    const normalized = writeQueryToStore({
      writer,
      result,
      query,
    });

    expect(normalized.toObject()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        id: 'abcd',
        stringField: 'This is a string!',
        numberField: 5,
        nullField: null,
      },
    });
  });

  it('properly normalizes a aliased fields with arguments', () => {
    const query = gql`
      {
        id
        aliasedField1: stringField(arg: 1)
        aliasedField2: stringField(arg: 2)
        numberField
        nullField
      }
    `;

    const result: any = {
      id: 'abcd',
      aliasedField1: 'The arg was 1!',
      aliasedField2: 'The arg was 2!',
      numberField: 5,
      nullField: null,
    };

    const normalized = writeQueryToStore({
      writer,
      result,
      query,
    });

    expect(normalized.toObject()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        id: 'abcd',
        'stringField({"arg":1})': 'The arg was 1!',
        'stringField({"arg":2})': 'The arg was 2!',
        numberField: 5,
        nullField: null,
      },
    });
  });

  it('properly normalizes a query with variables', () => {
    const query = gql`
      {
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

    const result: any = {
      id: 'abcd',
      stringField: 'Heyo',
      numberField: 5,
      nullField: null,
    };

    const normalized = writeQueryToStore({
      writer,
      result,
      query,
      variables,
    });

    expect(normalized.toObject()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        id: 'abcd',
        nullField: null,
        'numberField({"floatArg":3.14,"intArg":5})': 5,
        'stringField({"arg":"This is a string!"})': 'Heyo',
      },
    });
  });

  it('properly normalizes a query with default values', () => {
    const query = gql`
      query someBigQuery(
        $stringArg: String = "This is a default string!"
        $intArg: Int
        $floatArg: Float
      ) {
        id
        stringField(arg: $stringArg)
        numberField(intArg: $intArg, floatArg: $floatArg)
        nullField
      }
    `;

    const variables = {
      intArg: 5,
      floatArg: 3.14,
    };

    const result: any = {
      id: 'abcd',
      stringField: 'Heyo',
      numberField: 5,
      nullField: null,
    };

    const normalized = writeQueryToStore({
      writer,
      result,
      query,
      variables,
    });

    expect(normalized.toObject()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        id: 'abcd',
        nullField: null,
        'numberField({"floatArg":3.14,"intArg":5})': 5,
        'stringField({"arg":"This is a default string!"})': 'Heyo',
      },
    });
  });

  it('properly normalizes a query with custom directives', () => {
    const query = gql`
      query {
        id
        firstName @include(if: true)
        lastName @upperCase
        birthDate @dateFormat(format: "DD-MM-YYYY")
      }
    `;

    const result: any = {
      id: 'abcd',
      firstName: 'James',
      lastName: 'BOND',
      birthDate: '20-05-1940',
    };

    const normalized = writeQueryToStore({
      writer,
      result,
      query,
    });

    expect(normalized.toObject()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        id: 'abcd',
        firstName: 'James',
        'lastName@upperCase': 'BOND',
        'birthDate@dateFormat({"format":"DD-MM-YYYY"})': '20-05-1940',
      },
    });
  });

  it('properly normalizes a nested object with an ID', () => {
    const query = gql`
      {
        id
        stringField
        numberField
        nullField
        nestedObj {
          id
          stringField
          numberField
          nullField
        }
      }
    `;

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
      },
    };

    const writer = new StoreWriter(
      new InMemoryCache({
        dataIdFromObject: getIdField,
      }),
    );

    expect(
      writeQueryToStore({
        writer,
        query,
        result: cloneDeep(result),
      }).toObject(),
    ).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
        ...result,
        nestedObj: makeReference(result.nestedObj.id),
      },
      [result.nestedObj.id]: result.nestedObj,
    });
  });

  it('properly normalizes a nested object without an ID', () => {
    const query = gql`
      {
        id
        stringField
        numberField
        nullField
        nestedObj {
          stringField
          numberField
          nullField
        }
      }
    `;

    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedObj: {
        stringField: 'This is a string too!',
        numberField: 6,
        nullField: null,
      },
    };

    expect(
      writeQueryToStore({
        writer,
        query,
        result: cloneDeep(result),
      }).toObject(),
    ).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
        ...result,
      },
    });
  });

  it('properly normalizes a nested object with arguments but without an ID', () => {
    const query = gql`
      {
        id
        stringField
        numberField
        nullField
        nestedObj(arg: "val") {
          stringField
          numberField
          nullField
        }
      }
    `;

    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedObj: {
        stringField: 'This is a string too!',
        numberField: 6,
        nullField: null,
      },
    };

    expect(
      writeQueryToStore({
        writer,
        query,
        result: cloneDeep(result),
      }).toObject(),
    ).toEqual({
      ROOT_QUERY: assign(omit(result, 'nestedObj'), {
        __typename: "Query",
        'nestedObj({"arg":"val"})': result.nestedObj,
      }),
    });
  });

  it('properly normalizes a nested array with IDs', () => {
    const query = gql`
      {
        id
        stringField
        numberField
        nullField
        nestedArray {
          id
          stringField
          numberField
          nullField
        }
      }
    `;

    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedArray: [
        {
          id: 'abcde',
          stringField: 'This is a string too!',
          numberField: 6,
          nullField: null,
        },
        {
          id: 'abcdef',
          stringField: 'This is a string also!',
          numberField: 7,
          nullField: null,
        },
      ],
    };

    const writer = new StoreWriter(
      new InMemoryCache({
        dataIdFromObject: getIdField,
      }),
    );

    expect(
      writeQueryToStore({
        writer,
        query,
        result: cloneDeep(result),
      }).toObject(),
    ).toEqual({
      ROOT_QUERY: assign({}, assign({}, omit(result, 'nestedArray')), {
        __typename: "Query",
        nestedArray: result.nestedArray.map(
          (obj: any) => makeReference(obj.id),
        ),
      }),
      [result.nestedArray[0].id]: result.nestedArray[0],
      [result.nestedArray[1].id]: result.nestedArray[1],
    });
  });

  it('properly normalizes a nested array with IDs and a null', () => {
    const query = gql`
      {
        id
        stringField
        numberField
        nullField
        nestedArray {
          id
          stringField
          numberField
          nullField
        }
      }
    `;

    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedArray: [
        {
          id: 'abcde',
          stringField: 'This is a string too!',
          numberField: 6,
          nullField: null,
        },
        null,
      ],
    };

    const writer = new StoreWriter(
      new InMemoryCache({
        dataIdFromObject: getIdField,
      }),
    );

    expect(
      writeQueryToStore({
        writer,
        query,
        result: cloneDeep(result),
      }).toObject(),
    ).toEqual({
      ROOT_QUERY: assign({}, assign({}, omit(result, 'nestedArray')), {
        __typename: "Query",
        nestedArray: [makeReference(result.nestedArray[0].id), null],
      }),
      [result.nestedArray[0].id]: result.nestedArray[0],
    });
  });

  it('properly normalizes a nested array without IDs', () => {
    const query = gql`
      {
        id
        stringField
        numberField
        nullField
        nestedArray {
          stringField
          numberField
          nullField
        }
      }
    `;

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
      ],
    };

    const normalized = writeQueryToStore({
      writer,
      query,
      result: cloneDeep(result),
    });

    expect(normalized.toObject()).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
        ...result,
      },
    });
  });

  it('properly normalizes a nested array without IDs and a null item', () => {
    const query = gql`
      {
        id
        stringField
        numberField
        nullField
        nestedArray {
          stringField
          numberField
          nullField
        }
      }
    `;

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
      ],
    };

    const normalized = writeQueryToStore({
      writer,
      query,
      result: cloneDeep(result),
    });

    expect(normalized.toObject()).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
        ...result,
      },
    });
  });

  it('properly normalizes an array of non-objects', () => {
    const query = gql`
      {
        id
        stringField
        numberField
        nullField
        simpleArray
      }
    `;

    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      simpleArray: ['one', 'two', 'three'],
    };

    const writer = new StoreWriter(
      new InMemoryCache({
        dataIdFromObject: getIdField,
      }),
    );

    const normalized = writeQueryToStore({
      writer,
      query,
      result: cloneDeep(result),
    });

    expect(normalized.toObject()).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
        ...result,
      },
    });
  });

  it('properly normalizes an array of non-objects with null', () => {
    const query = gql`
      {
        id
        stringField
        numberField
        nullField
        simpleArray
      }
    `;

    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      simpleArray: [null, 'two', 'three'],
    };

    const normalized = writeQueryToStore({
      writer,
      query,
      result: cloneDeep(result),
    });

    expect(normalized.toObject()).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
        ...result,
      },
    });
  });

  it('properly normalizes an object occurring in different graphql paths twice', () => {
    const query = gql`
      {
        id
        object1 {
          id
          stringField
        }
        object2 {
          id
          numberField
        }
      }
    `;

    const result: any = {
      id: 'a',
      object1: {
        id: 'aa',
        stringField: 'string',
      },
      object2: {
        id: 'aa',
        numberField: 1,
      },
    };

    const writer = new StoreWriter(
      new InMemoryCache({
        dataIdFromObject: getIdField,
      }),
    );

    const normalized = writeQueryToStore({
      writer,
      query,
      result: cloneDeep(result),
    });

    expect(normalized.toObject()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        id: 'a',
        object1: makeReference('aa'),
        object2: makeReference('aa'),
      },
      aa: {
        id: 'aa',
        stringField: 'string',
        numberField: 1,
      },
    });
  });

  it('properly normalizes an object occurring in different graphql array paths twice', () => {
    const query = gql`
      {
        id
        array1 {
          id
          stringField
          obj {
            id
            stringField
          }
        }
        array2 {
          id
          stringField
          obj {
            id
            numberField
          }
        }
      }
    `;

    const result: any = {
      id: 'a',
      array1: [
        {
          id: 'aa',
          stringField: 'string',
          obj: {
            id: 'aaa',
            stringField: 'string',
          },
        },
      ],
      array2: [
        {
          id: 'ab',
          stringField: 'string2',
          obj: {
            id: 'aaa',
            numberField: 1,
          },
        },
      ],
    };

    const writer = new StoreWriter(
      new InMemoryCache({
        dataIdFromObject: getIdField,
      }),
    );

    const normalized = writeQueryToStore({
      writer,
      query,
      result: cloneDeep(result),
    });

    expect(normalized.toObject()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        id: 'a',
        array1: [makeReference('aa')],
        array2: [makeReference('ab')],
      },
      aa: {
        id: 'aa',
        stringField: 'string',
        obj: makeReference('aaa'),
      },
      ab: {
        id: 'ab',
        stringField: 'string2',
        obj: makeReference('aaa'),
      },
      aaa: {
        id: 'aaa',
        stringField: 'string',
        numberField: 1,
      },
    });
  });

  it('properly normalizes an object occurring in the same graphql array path twice', () => {
    const query = gql`
      {
        id
        array1 {
          id
          stringField
          obj {
            id
            stringField
            numberField
          }
        }
      }
    `;

    const result: any = {
      id: 'a',
      array1: [
        {
          id: 'aa',
          stringField: 'string',
          obj: {
            id: 'aaa',
            stringField: 'string',
            numberField: 1,
          },
        },
        {
          id: 'ab',
          stringField: 'string2',
          obj: {
            id: 'aaa',
            stringField: 'should not be written',
            numberField: 2,
          },
        },
      ],
    };

    const writer = new StoreWriter(
      new InMemoryCache({
        dataIdFromObject: getIdField,
      }),
    );

    const normalized = writeQueryToStore({
      writer,
      query,
      result: cloneDeep(result),
    });

    expect(normalized.toObject()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        id: 'a',
        array1: [makeReference('aa'), makeReference('ab')],
      },
      aa: {
        id: 'aa',
        stringField: 'string',
        obj: makeReference('aaa'),
      },
      ab: {
        id: 'ab',
        stringField: 'string2',
        obj: makeReference('aaa'),
      },
      aaa: {
        id: 'aaa',
        stringField: 'string',
        numberField: 1,
      },
    });
  });

  it('merges nodes', () => {
    const query = gql`
      {
        id
        numberField
        nullField
      }
    `;

    const result: any = {
      id: 'abcd',
      numberField: 5,
      nullField: null,
    };

    const writer = new StoreWriter(
      new InMemoryCache({
        dataIdFromObject: getIdField,
      }),
    );

    const store = writeQueryToStore({
      writer,
      query,
      result: cloneDeep(result),
    });

    const query2 = gql`
      {
        id
        stringField
        nullField
      }
    `;

    const result2: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      nullField: null,
    };

    const store2 = writeQueryToStore({
      writer,
      store,
      query: query2,
      result: result2,
    });

    expect(store2.toObject()).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
        ...result,
        ...result2,
      },
    });
  });

  it('properly normalizes a nested object that returns null', () => {
    const query = gql`
      {
        id
        stringField
        numberField
        nullField
        nestedObj {
          id
          stringField
          numberField
          nullField
        }
      }
    `;

    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
      nestedObj: null,
    };

    expect(
      writeQueryToStore({
        writer,
        query,
        result: cloneDeep(result),
      }).toObject(),
    ).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
        ...result,
        nestedObj: null,
      },
    });
  });

  it('properly normalizes an object with an ID when no extension is passed', () => {
    const query = gql`
      {
        people_one(id: "5") {
          id
          stringField
        }
      }
    `;

    const result: any = {
      people_one: {
        id: 'abcd',
        stringField: 'This is a string!',
      },
    };

    expect(
      writeQueryToStore({
        writer,
        query,
        result: cloneDeep(result),
      }).toObject(),
    ).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        'people_one({"id":"5"})': {
          id: 'abcd',
          stringField: 'This is a string!',
        },
      },
    });
  });

  it('consistently serialize different types of input when passed inlined or as variable', () => {
    const testData = [
      {
        mutation: gql`
          mutation mut($in: Int!) {
            mut(inline: 5, variable: $in) {
              id
            }
          }
        `,
        variables: { in: 5 },
        expected: 'mut({"inline":5,"variable":5})',
      },
      {
        mutation: gql`
          mutation mut($in: Float!) {
            mut(inline: 5.5, variable: $in) {
              id
            }
          }
        `,
        variables: { in: 5.5 },
        expected: 'mut({"inline":5.5,"variable":5.5})',
      },
      {
        mutation: gql`
          mutation mut($in: String!) {
            mut(inline: "abc", variable: $in) {
              id
            }
          }
        `,
        variables: { in: 'abc' },
        expected: 'mut({"inline":"abc","variable":"abc"})',
      },
      {
        mutation: gql`
          mutation mut($in: Array!) {
            mut(inline: [1, 2], variable: $in) {
              id
            }
          }
        `,
        variables: { in: [1, 2] },
        expected: 'mut({"inline":[1,2],"variable":[1,2]})',
      },
      {
        mutation: gql`
          mutation mut($in: Object!) {
            mut(inline: { a: 1 }, variable: $in) {
              id
            }
          }
        `,
        variables: { in: { a: 1 } },
        expected: 'mut({"inline":{"a":1},"variable":{"a":1}})',
      },
      {
        mutation: gql`
          mutation mut($in: Boolean!) {
            mut(inline: true, variable: $in) {
              id
            }
          }
        `,
        variables: { in: true },
        expected: 'mut({"inline":true,"variable":true})',
      },
    ];

    function isOperationDefinition(
      definition: DefinitionNode,
    ): definition is OperationDefinitionNode {
      return definition.kind === 'OperationDefinition';
    }

    function isField(selection: SelectionNode): selection is FieldNode {
      return selection.kind === 'Field';
    }

    testData.forEach(data => {
      data.mutation.definitions.forEach(
        (definition: OperationDefinitionNode) => {
          if (isOperationDefinition(definition)) {
            definition.selectionSet.selections.forEach(selection => {
              if (isField(selection)) {
                expect(
                  storeKeyNameFromField(selection, data.variables),
                ).toEqual(data.expected);
              }
            });
          }
        },
      );
    });
  });

  it('properly normalizes a mutation with object or array parameters and variables', () => {
    const mutation = gql`
      mutation some_mutation($nil: ID, $in: Object) {
        some_mutation(
          input: {
            id: "5"
            arr: [1, { a: "b" }]
            obj: { a: "b" }
            num: 5.5
            nil: $nil
            bo: true
          }
        ) {
          id
        }
        some_mutation_with_variables(input: $in) {
          id
        }
      }
    `;

    const result: any = {
      some_mutation: {
        id: 'id',
      },
      some_mutation_with_variables: {
        id: 'id',
      },
    };

    const variables: any = {
      nil: null,
      in: {
        id: '5',
        arr: [1, { a: 'b' }],
        obj: { a: 'b' },
        num: 5.5,
        nil: null,
        bo: true,
      },
    };

    function isOperationDefinition(
      value: ASTNode,
    ): value is OperationDefinitionNode {
      return value.kind === 'OperationDefinition';
    }

    mutation.definitions.map((def: OperationDefinitionNode) => {
      if (isOperationDefinition(def)) {
        const writer = new StoreWriter(
          new InMemoryCache({
            dataIdFromObject() {
              return '5';
            },
          }),
        );

        expect(
          writeQueryToStore({
            writer,
            query: {
              kind: 'Document',
              definitions: [def],
            } as DocumentNode,
            dataId: '5',
            result,
            variables,
          }).toObject(),
        ).toEqual({
          '5': {
            id: 'id',
            'some_mutation({"input":{"arr":[1,{"a":"b"}],"bo":true,"id":"5","nil":null,"num":5.5,"obj":{"a":"b"}}})': makeReference('5'),
            'some_mutation_with_variables({"input":{"arr":[1,{"a":"b"}],"bo":true,"id":"5","nil":null,"num":5.5,"obj":{"a":"b"}}})': makeReference('5'),
          },
        });
      } else {
        throw 'No operation definition found';
      }
    });
  });

  describe('type escaping', () => {
    it('should correctly escape generated ids', () => {
      const query = gql`
        query {
          author {
            firstName
            lastName
          }
        }
      `;
      const data = {
        author: {
          firstName: 'John',
          lastName: 'Smith',
        },
      };
      const expStore = defaultNormalizedCacheFactory({
        ROOT_QUERY: {
          __typename: 'Query',
          ...data,
        },
      });
      expect(
        writeQueryToStore({
          writer,
          result: data,
          query,
        }).toObject(),
      ).toEqual(expStore.toObject());
    });

    it('should correctly escape real ids', () => {
      const query = gql`
        query {
          author {
            firstName
            id
            __typename
          }
        }
      `;
      const data = {
        author: {
          firstName: 'John',
          id: '129',
          __typename: 'Author',
        },
      };
      const expStore = defaultNormalizedCacheFactory({
        ROOT_QUERY: {
          __typename: 'Query',
          author: makeReference(cache.identify(data.author)!),
        },
        [cache.identify(data.author)!]: {
          firstName: data.author.firstName,
          id: data.author.id,
          __typename: data.author.__typename,
        },
      });
      expect(
        writeQueryToStore({
          writer,
          result: data,
          query,
        }).toObject(),
      ).toEqual(expStore.toObject());
    });

    it('should not need to escape json blobs', () => {
      const query = gql`
        query {
          author {
            info
            id
            __typename
          }
        }
      `;
      const data = {
        author: {
          info: {
            name: 'John',
          },
          id: '129',
          __typename: 'Author',
        },
      };
      const expStore = defaultNormalizedCacheFactory({
        ROOT_QUERY: {
          __typename: 'Query',
          author: makeReference(cache.identify(data.author)!),
        },
        [cache.identify(data.author)!]: {
          __typename: data.author.__typename,
          id: data.author.id,
          info: data.author.info,
        },
      });
      expect(
        writeQueryToStore({
          writer,
          result: data,
          query,
        }).toObject(),
      ).toEqual(expStore.toObject());
    });
  });

  it('should not merge unidentified data when replacing with ID reference', () => {
    const dataWithoutId = {
      author: {
        firstName: 'John',
        lastName: 'Smith',
        __typename: 'Author',
      },
    };

    const dataWithId = {
      author: {
        firstName: 'John',
        id: '129',
        __typename: 'Author',
      },
    };

    const queryWithoutId = gql`
      query {
        author {
          firstName
          lastName
          __typename
        }
      }
    `;
    const queryWithId = gql`
      query {
        author {
          firstName
          id
          __typename
        }
      }
    `;

    const cache = new InMemoryCache({
      typePolicies: {
        Query: {
          fields: {
            author: {
              // Silence "Cache data may be lost..." warnings by always
              // preferring the incoming value.
              merge(existing, incoming, { readField, isReference }) {
                if (existing) {
                  expect(isReference(existing)).toBe(false);
                  expect(readField({
                    fieldName: "__typename",
                    from: existing,
                  })).toBe("Author");

                  expect(isReference(incoming)).toBe(true);
                  expect(readField({
                    fieldName: "__typename",
                    from: incoming,
                  })).toBe("Author");
                }

                return incoming;
              },
            },
          },
        },
      },
      dataIdFromObject(object: any) {
        if (object.__typename && object.id) {
          return object.__typename + '__' + object.id;
        }
      },
    });

    cache.writeQuery({
      query: queryWithoutId,
      data: dataWithoutId,
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
        author: {
          firstName: 'John',
          lastName: 'Smith',
          __typename: 'Author',
        },
      },
    });

    cache.writeQuery({
      query: queryWithId,
      data: dataWithId,
    });

    expect(cache.extract()).toEqual({
      Author__129: {
        firstName: 'John',
        id: '129',
        __typename: 'Author',
      },
      ROOT_QUERY: {
        __typename: 'Query',
        author: makeReference('Author__129'),
      },
    });
  });

  it('correctly merges fragment fields along multiple paths', () => {
    const cache = new InMemoryCache({
      typePolicies: {
        Container: {
          // Uncommenting this line fixes the test, but should not be necessary,
          // since the Container response object in question has the same
          // identity along both paths.
          // merge: true,
        },
      },
    });

    const query = gql`
      query Query {
        item(id: "123") {
          id
          value {
            ...ContainerFragment
          }
        }
      }

      fragment ContainerFragment on Container {
        value {
          ...ValueFragment
          item {
            id
            value {
              text
            }
          }
        }
      }

      fragment ValueFragment on Value {
        item {
          ...ItemFragment
        }
      }

      fragment ItemFragment on Item {
        value {
          value {
            __typename
          }
        }
      }
    `;

    const data = {
      item: {
        __typename: "Item",
        id: "0f47f85d-8081-466e-9121-c94069a77c3e",
        value: {
          __typename: "Container",
          value: {
            __typename: "Value",
            item: {
              __typename: "Item",
              id: "6dc3530b-6731-435e-b12a-0089d0ae05ac",
              value: {
                __typename: "Container",
                text: "Hello World",
                value: {
                  __typename: "Value"
                },
              },
            },
          },
        },
      },
    };

    cache.writeQuery({
      query,
      data,
    });

    expect(cache.readQuery({ query })).toEqual(data);
    expect(cache.extract()).toMatchSnapshot();
  });

  it('should respect id fields added by fragments', () => {
    const query = gql`
      query ABCQuery {
        __typename
        a {
          __typename
          id
          ...SharedFragment
          b {
            __typename
            c {
              __typename
              title
              titleSize
            }
          }
        }
      }
      fragment SharedFragment on AShared {
        __typename
        b {
          __typename
          id
          c {
            __typename
          }
        }
      }
    `;

    const data = {
      __typename: "Query",
      a: {
        __typename: "AType",
        id: "a-id",
        b: [{
          __typename: "BType",
          id: "b-id",
          c: {
            __typename: "CType",
            title: "Your experience",
            titleSize: null
          },
        }],
      },
    };

    const cache = new InMemoryCache({
      possibleTypes: { AShared: ["AType"] }
    });

    cache.writeQuery({ query, data });
    expect(cache.readQuery({ query })).toEqual(data);

    expect(cache.extract()).toMatchSnapshot();
  });

  it('should allow a union of objects of a different type, when overwriting a generated id with a real id', () => {
    const dataWithPlaceholder = {
      author: {
        hello: 'Foo',
        __typename: 'Placeholder',
      },
    };
    const dataWithAuthor = {
      author: {
        firstName: 'John',
        lastName: 'Smith',
        id: '129',
        __typename: 'Author',
      },
    };
    const query = gql`
      query {
        author {
          ... on Author {
            firstName
            lastName
            id
            __typename
          }
          ... on Placeholder {
            hello
            __typename
          }
        }
      }
    `;

    let mergeCount = 0;
    const cache = new InMemoryCache({
      typePolicies: {
        Query: {
          fields: {
            author: {
              merge(existing, incoming, { isReference, readField }) {
                switch (++mergeCount) {
                  case 1:
                    expect(existing).toBeUndefined();
                    expect(isReference(incoming)).toBe(false);
                    expect(incoming).toEqual(dataWithPlaceholder.author);
                    break;
                  case 2:
                    expect(existing).toEqual(dataWithPlaceholder.author);
                    expect(isReference(incoming)).toBe(true);
                    expect(readField("__typename", incoming)).toBe("Author");
                    break;
                  case 3:
                    expect(isReference(existing)).toBe(true);
                    expect(readField("__typename", existing)).toBe("Author");
                    expect(incoming).toEqual(dataWithPlaceholder.author);
                    break;
                  default:
                    fail("unreached");
                }
                return incoming;
              },
            },
          },
        },
      },
    });

    // write the first object, without an ID, placeholder
    cache.writeQuery({
      query,
      data: dataWithPlaceholder,
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        __typename: 'Query',
        author: {
          hello: 'Foo',
          __typename: 'Placeholder',
        },
      },
    });

    // replace with another one of different type with ID
    cache.writeQuery({
      query,
      data: dataWithAuthor,
    });

    expect(cache.extract()).toEqual({
      "Author:129": {
        firstName: 'John',
        lastName: 'Smith',
        id: '129',
        __typename: 'Author',
      },
      ROOT_QUERY: {
        __typename: 'Query',
        author: makeReference('Author:129'),
      },
    });

    // and go back to the original:
    cache.writeQuery({
      query,
      data: dataWithPlaceholder,
    });

    // Author__129 will remain in the store,
    // but will not be referenced by any of the fields,
    // hence we combine, and in that very order
    expect(cache.extract()).toEqual({
      "Author:129": {
        firstName: 'John',
        lastName: 'Smith',
        id: '129',
        __typename: 'Author',
      },
      ROOT_QUERY: {
        __typename: 'Query',
        author: {
          hello: 'Foo',
          __typename: 'Placeholder',
        },
      },
    });
  });

  it('does not swallow errors other than field errors', () => {
    const query = gql`
      query {
        ...notARealFragment
        fortuneCookie
      }
    `;
    const result: any = {
      fortuneCookie: 'Star Wars unit tests are boring',
    };
    expect(() => {
      writeQueryToStore({
        writer,
        result,
        query,
      });
    }).toThrowError(/No fragment/);
  });

  it('does not change object references if the value is the same', () => {
    const query = gql`
      {
        id
        stringField
        numberField
        nullField
      }
    `;

    const result: any = {
      id: 'abcd',
      stringField: 'This is a string!',
      numberField: 5,
      nullField: null,
    };
    const store = writeQueryToStore({
      writer,
      query,
      result: cloneDeep(result),
    });

    const newStore = writeQueryToStore({
      writer,
      query,
      result: cloneDeep(result),
      store: defaultNormalizedCacheFactory(store.toObject()),
    });

    Object.keys(store.toObject()).forEach(field => {
      expect((store as any).lookup(field)).toEqual((newStore as any).lookup(field));
    });
  });

  describe('"Cache data maybe lost..." warnings', () => {
    const { warn } = console;
    let warnings: any[][] = [];

    beforeEach(() => {
      warnings.length = 0;
      console.warn = (...args: any[]) => {
        warnings.push(args);
      };
    });

    afterEach(() => {
      console.warn = warn;
    });

    it("should not warn when scalar fields are updated", () => {
      const cache = new InMemoryCache;

      const query = gql`
        query {
          someJSON
          currentTime(tz: "UTC-5")
        }
      `;

      expect(warnings).toEqual([]);

      const date = new Date(1601053713081);

      cache.writeQuery({
        query,
        data: {
          someJSON: {
            oyez: 3,
            foos: ["bar", "baz"],
          },
          currentTime: {
            localeString: date.toLocaleString("en-US", {
              timeZone: "America/New_York",
            }),
          },
        },
      });

      expect(cache.extract()).toMatchSnapshot();
      expect(warnings).toEqual([]);

      cache.writeQuery({
        query,
        data: {
          someJSON: {
            qwer: "upper",
            asdf: "middle",
            zxcv: "lower",
          },
          currentTime: {
            msSinceEpoch: date.getTime(),
          },
        },
      });

      expect(cache.extract()).toMatchSnapshot();
      expect(warnings).toEqual([]);
    });
  });

  describe('writeResultToStore shape checking', () => {
    const query = gql`
      query {
        todos {
          id
          name
          description
        }
      }
    `;

    withErrorSpy(it, 'should write the result data without validating its shape when a fragment matcher is not provided', () => {
      const result = {
        todos: [
          {
            id: '1',
            name: 'Todo 1',
          },
        ],
      };

      const writer = new StoreWriter(
        new InMemoryCache({
          dataIdFromObject: getIdField,
        }),
      );

      const newStore = writeQueryToStore({
        writer,
        query,
        result,
      });

      expect((newStore as any).lookup('1')).toEqual(result.todos[0]);
    });

    withErrorSpy(it, 'should warn when it receives the wrong data with non-union fragments', () => {
      const result = {
        todos: [
          {
            id: '1',
            name: 'Todo 1',
          },
        ],
      };

      const writer = new StoreWriter(
        new InMemoryCache({
          dataIdFromObject: getIdField,
          possibleTypes: {},
        }),
      );

      writeQueryToStore({
        writer,
        query,
        result,
      });
    });

    it('should warn when it receives the wrong data inside a fragment', () => {
      const queryWithInterface = gql`
        query {
          todos {
            id
            name
            description
            ...TodoFragment
          }
        }

        fragment TodoFragment on Todo {
          ... on ShoppingCartItem {
            price
            __typename
          }
          ... on TaskItem {
            date
            __typename
          }
          __typename
        }
      `;

      const result = {
        todos: [
          {
            id: '1',
            name: 'Todo 1',
            description: 'Description 1',
            __typename: 'ShoppingCartItem',
          },
        ],
      };

      const writer = new StoreWriter(
        new InMemoryCache({
          dataIdFromObject: getIdField,
          possibleTypes: {
            Todo: ["ShoppingCartItem", "TaskItem"],
          },
        }),
      );

      writeQueryToStore({
        writer,
        query: queryWithInterface,
        result,
      });
    });

    it('should warn if a result is missing __typename when required', () => {
      const result: any = {
        todos: [
          {
            id: '1',
            name: 'Todo 1',
            description: 'Description 1',
          },
        ],
      };

      const writer = new StoreWriter(
        new InMemoryCache({
          dataIdFromObject: getIdField,
          possibleTypes: {},
        }),
      );

      writeQueryToStore({
        writer,
        query: addTypenameToDocument(query),
        result,
      });
    });

    it('should not warn if a field is null', () => {
      const result: any = {
        todos: null,
      };

      const writer = new StoreWriter(
        new InMemoryCache({
          dataIdFromObject: getIdField,
        }),
      );

      const newStore = writeQueryToStore({
        writer,
        query,
        result,
      });

      expect((newStore as any).lookup('ROOT_QUERY')).toEqual({
        __typename: 'Query',
        todos: null,
      });
    });
    it('should not warn if a field is defered', () => {
      let originalWarn = console.warn;
      console.warn = jest.fn((...args) => {});
      const defered = gql`
        query LazyLoad {
          id
          expensive @defer
        }
      `;
      const result: any = {
        id: 1,
      };

      const writer = new StoreWriter(
        new InMemoryCache({
          dataIdFromObject: getIdField,
        }),
      );

      const newStore = writeQueryToStore({
        writer,
        query: defered,
        result,
      });

      expect((newStore as any).lookup('ROOT_QUERY')).toEqual({ __typename: 'Query', id: 1 });
      expect(console.warn).not.toBeCalled();
      console.warn = originalWarn;
    });
  });

  it('properly handles the @connection directive', () => {
    const store = defaultNormalizedCacheFactory();

    writeQueryToStore({
      writer,
      query: gql`
        {
          books(skip: 0, limit: 2) @connection(key: "abc") {
            name
          }
        }
      `,
      result: {
        books: [
          {
            name: 'abcd',
          },
        ],
      },
      store,
    });

    writeQueryToStore({
      writer,
      query: gql`
        {
          books(skip: 2, limit: 4) @connection(key: "abc") {
            name
          }
        }
      `,
      result: {
        books: [
          {
            name: 'efgh',
          },
        ],
      },
      store,
    });

    expect(store.toObject()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        'books:abc': [
          {
            name: 'efgh',
          },
        ],
      },
    });
  });

  it('can use keyArgs function instead of @connection directive', () => {
    const store = defaultNormalizedCacheFactory();
    const writer = new StoreWriter(
      new InMemoryCache({
        typePolicies: {
          Query: {
            fields: {
              books: {
                keyArgs: () => "abc",
              },
            },
          },
        },
      }),
    );

    writeQueryToStore({
      writer,
      query: gql`
        {
          books(skip: 0, limit: 2) {
            name
          }
        }
      `,
      result: {
        books: [
          {
            name: 'abcd',
          },
        ],
      },
      store,
    });

    expect(store.toObject()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        "books:abc": [
          {
            name: 'abcd',
          },
        ],
      },
    });

    writeQueryToStore({
      writer,
      query: gql`
        {
          books(skip: 2, limit: 4) {
            name
          }
        }
      `,
      result: {
        books: [
          {
            name: 'efgh',
          },
        ],
      },
      store,
    });

    expect(store.toObject()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        "books:abc": [
          {
            name: 'efgh',
          },
        ],
      },
    });
  });

  it('should keep reference when type of mixed inlined field changes', () => {
    const store = defaultNormalizedCacheFactory();

    const query = gql`
      query {
        animals {
          species {
            name
          }
        }
      }
    `;

    writeQueryToStore({
      writer,
      query,
      result: {
        animals: [
          {
            __typename: 'Animal',
            species: {
              __typename: 'Cat',
              name: 'cat',
            },
          },
        ],
      },
      store,
    });

    expect(store.toObject()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        animals: [
          {
            __typename: 'Animal',
            species: {
              __typename: 'Cat',
              name: 'cat',
            },
          },
        ],
      },
    });

    writeQueryToStore({
      writer,
      query,
      result: {
        animals: [
          {
            __typename: 'Animal',
            species: {
              __typename: 'Dog',
              name: 'dog',
            },
          },
        ],
      },
      store,
    });

    expect(store.toObject()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        animals: [
          {
            __typename: 'Animal',
            species: {
              __typename: 'Dog',
              name: 'dog',
            },
          },
        ],
      },
    });
  });

  withErrorSpy(it, 'should not keep reference when type of mixed inlined field changes to non-inlined field', () => {
    const store = defaultNormalizedCacheFactory();

    const query = gql`
      query {
        animals {
          species {
            id
            name
          }
        }
      }
    `;

    writeQueryToStore({
      writer,
      query,
      result: {
        animals: [
          {
            __typename: 'Animal',
            species: {
              __typename: 'Cat',
              name: 'cat',
            },
          },
        ],
      },
      store,
    });

    expect(store.toObject()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        animals: [
          {
            __typename: 'Animal',
            species: {
              __typename: 'Cat',
              name: 'cat',
            },
          },
        ],
      },
    });

    writeQueryToStore({
      writer,
      query,
      result: {
        animals: [
          {
            __typename: 'Animal',
            species: {
              id: 'dog-species',
              __typename: 'Dog',
              name: 'dog',
            },
          },
        ],
      },
      store,
    });

    expect(store.toObject()).toEqual({
      'Dog__dog-species': {
        id: 'dog-species',
        __typename: 'Dog',
        name: 'dog',
      },
      ROOT_QUERY: {
        __typename: "Query",
        animals: [
          {
            __typename: 'Animal',
            species: makeReference('Dog__dog-species'),
          },
        ],
      },
    });
  });

  it('should not deep-freeze scalar objects', () => {
    const query = gql`
      query {
        scalarFieldWithObjectValue
      }
    `;

    const scalarObject = {
      a: 1,
      b: [2, 3],
      c: {
        d: 4,
        e: 5,
      },
    };

    const cache = new InMemoryCache();

    cache.writeQuery({
      query,
      data: {
        scalarFieldWithObjectValue: scalarObject,
      },
    });

    expect(Object.isFrozen(scalarObject)).toBe(false);
    expect(Object.isFrozen(scalarObject.b)).toBe(false);
    expect(Object.isFrozen(scalarObject.c)).toBe(false);

    const result = cache.readQuery<any>({ query });
    expect(result.scalarFieldWithObjectValue).not.toBe(scalarObject);
    expect(Object.isFrozen(result.scalarFieldWithObjectValue)).toBe(true);
    expect(Object.isFrozen(result.scalarFieldWithObjectValue.b)).toBe(true);
    expect(Object.isFrozen(result.scalarFieldWithObjectValue.c)).toBe(true);
  });

  it("should skip writing still-fresh result objects", function () {
    const cache = new InMemoryCache({
      typePolicies: {
        Todo: {
          fields: {
            text: {
              merge(_, text: string) {
                mergeCounts[text] = ~~mergeCounts[text] + 1;
                return text;
              },
            },
          },
        },
      },
    });

    const mergeCounts: Record<string, number> = Object.create(null);

    const query = gql`
      query {
        todos {
          id
          text
        }
      }
    `;

    expect(mergeCounts).toEqual({});

    cache.writeQuery({
      query,
      data: {
        todos: [
          { __typename: "Todo", id: 1, text: "first" },
          { __typename: "Todo", id: 2, text: "second" },
        ],
      },
    });

    expect(mergeCounts).toEqual({ first: 1, second: 1 });

    function read() {
      return cache.readQuery<{ todos: any[] }>({ query })!.todos;
    }

    const twoTodos = read();

    expect(mergeCounts).toEqual({ first: 1, second: 1 });

    const threeTodos = [
      ...twoTodos,
      { __typename: "Todo", id: 3, text: "third" },
    ];

    cache.writeQuery({
      query,
      data: {
        todos: threeTodos,
      },
    });

    expect(mergeCounts).toEqual({ first: 1, second: 1, third: 1 });

    const threeTodosAgain = read();
    twoTodos.forEach((todo, i) => expect(todo).toBe(threeTodosAgain[i]));

    const fourTodos = [
      threeTodosAgain[2],
      threeTodosAgain[0],
      { __typename: "Todo", id: 4, text: "fourth" },
      threeTodosAgain[1],
    ];

    cache.writeQuery({
      query,
      data: {
        todos: fourTodos,
      },
    });

    expect(mergeCounts).toEqual({ first: 1, second: 1, third: 1, fourth: 1 });
  });

  itAsync("should allow silencing broadcast of cache updates", function (resolve, reject) {
    const cache = new InMemoryCache({
      typePolicies: {
        Counter: {
          // Counter is a singleton, but we want to be able to test
          // writing to it with writeFragment, so it needs to have an ID.
          keyFields: [],
        },
      },
    });

    const query = gql`
      query {
        counter {
          count
        }
      }
    `;

    const results: number[] = [];

    cache.watch({
      query,
      optimistic: true,
      callback(diff) {
        results.push(diff.result);
        expect(diff.result).toEqual({
          counter: {
            __typename: "Counter",
            count: 3,
          },
        });
        resolve();
      },
    });

    let count = 0;

    cache.writeQuery({
      query,
      data: {
        counter: {
          __typename: "Counter",
          count: ++count,
        },
      },
      broadcast: false,
    });

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        counter: { __ref: "Counter:{}" },
      },
      "Counter:{}": {
        __typename: "Counter",
        count: 1,
      },
    });

    expect(results).toEqual([]);

    const counterId = cache.identify({
      __typename: "Counter",
    })!;

    cache.writeFragment({
      id: counterId,
      fragment: gql`fragment Count on Counter { count }`,
      data: {
        count: ++count,
      },
      broadcast: false,
    });

    const counterMeta = {
      extraRootIds: [
        "Counter:{}",
      ],
    };

    expect(cache.extract()).toEqual({
      __META: counterMeta,
      ROOT_QUERY: {
        __typename: "Query",
        counter: { __ref: "Counter:{}" },
      },
      "Counter:{}": {
        __typename: "Counter",
        count: 2,
      },
    });

    expect(results).toEqual([]);

    expect(cache.evict({
      id: counterId,
      fieldName: "count",
      broadcast: false,
    })).toBe(true);

    expect(cache.extract()).toEqual({
      __META: counterMeta,
      ROOT_QUERY: {
        __typename: "Query",
        counter: { __ref: "Counter:{}" },
      },
      "Counter:{}": {
        __typename: "Counter",
      },
    });

    expect(results).toEqual([]);

    // Only this write should trigger a broadcast.
    cache.writeQuery({
      query,
      data: {
        counter: {
          __typename: "Counter",
          count: 3,
        },
      },
    });
  });

  it("writeFragment should be able to infer ROOT_QUERY", () => {
    const cache = new InMemoryCache;

    const ref = cache.writeFragment({
      fragment: gql`fragment RootField on Query { field }`,
      data: {
        __typename: "Query",
        field: "value",
      },
    });

    expect(isReference(ref)).toBe(true);
    expect(ref!.__ref).toBe("ROOT_QUERY");

    expect(cache.extract()).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        field: "value",
      },
    });
  });

  it("should warn if it cannot identify the result object", () => {
    const cache = new InMemoryCache;

    expect(() => {
      cache.writeFragment({
        fragment: gql`fragment Count on Counter { count }`,
        data: {
          count: 1,
        },
      });
    }).toThrowError(/Could not identify object/);
  });

  it('user objects should be able to have { __typename: "Subscription" }', () => {
    const cache = new InMemoryCache({
      typePolicies: {
        Subscription: {
          keyFields: ["subId"],
        },
      },
    });

    const query = gql`
      query {
        subscriptions {
          __typename
          subscriber {
            name
          }
        }
      }
    `;

    cache.writeQuery({
      query,
      data: {
        subscriptions: [
          {
            __typename: "Subscription",
            subId: 1,
            subscriber: {
              name: "Alice",
            },
          },
          {
            __typename: "Subscription",
            subId: 2,
            subscriber: {
              name: "Bob",
            },
          },
          {
            __typename: "Subscription",
            subId: 3,
            subscriber: {
              name: "Clytemnestra",
            },
          },
        ],
      },
    });

    expect(cache.extract()).toMatchSnapshot();
    expect(cache.readQuery({ query })).toEqual({
      subscriptions: [
        { __typename: "Subscription", subscriber: { name: "Alice" }},
        { __typename: "Subscription", subscriber: { name: "Bob" }},
        { __typename: "Subscription", subscriber: { name: "Clytemnestra" }},
      ],
    });
  });

  it('user objects should be able to have { __typename: "Mutation" }', () => {
    const cache = new InMemoryCache({
      typePolicies: {
        Mutation: {
          keyFields: ["gene", ["id"], "name"],
        },
        Gene: {
          keyFields: ["id"],
        },
      },
    });

    const query = gql`
      query {
        mutations {
          __typename
          gene { id }
          name
        }
      }
    `;

    cache.writeQuery({
      query,
      data: {
        mutations: [
          {
            __typename: "Mutation",
            gene: {
              __typename: "Gene",
              id: "SLC45A2",
            },
            name: "albinism",
          },
          {
            __typename: "Mutation",
            gene: {
              __typename: "Gene",
              id: "SNAI2",
            },
            name: "piebaldism",
          },
        ],
      },
    });

    expect(cache.extract()).toMatchSnapshot();
    expect(cache.readQuery({ query })).toEqual({
      mutations: [
        {
          __typename: "Mutation",
          gene: { __typename: "Gene", id: "SLC45A2" },
          name: "albinism",
        },
        {
          __typename: "Mutation",
          gene: { __typename: "Gene", id: "SNAI2" },
          name: "piebaldism",
        },
      ],
    });
  });
});
