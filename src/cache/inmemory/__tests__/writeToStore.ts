import { assign, omit } from 'lodash';
import type {
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
} from '../../../utilities/graphql/storeUtils';
import { addTypenameToDocument } from '../../../utilities/graphql/transform';
import { cloneDeep } from '../../../utilities/common/cloneDeep';
import { itAsync } from '../../../utilities/testing/itAsync';
import { StoreWriter } from '../writeToStore';
import { defaultNormalizedCacheFactory } from '../entityStore';
import { InMemoryCache } from '../inMemoryCache';
import { Policies } from '../policies';

const getIdField = ({ id }: { id: string }) => id;

describe('writing to the store', () => {
  const policies = new Policies({
    dataIdFromObject(object: any) {
      if (object.__typename && object.id) {
        return object.__typename + '__' + object.id;
      }
    },
  });

  const writer = new StoreWriter({ policies });

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
      writer
        .writeQueryToStore({
          query,
          result: cloneDeep(result),
        })
        .toObject(),
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

    const normalized = writer.writeQueryToStore({
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

    const normalized = writer.writeQueryToStore({
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

    const normalized = writer.writeQueryToStore({
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

    const normalized = writer.writeQueryToStore({
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

    const normalized = writer.writeQueryToStore({
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

    const writer = new StoreWriter({
      policies: new Policies({
        dataIdFromObject: getIdField,
      }),
    });

    expect(
      writer
        .writeQueryToStore({
          query,
          result: cloneDeep(result),
        })
        .toObject(),
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
      writer
        .writeQueryToStore({
          query,
          result: cloneDeep(result),
        })
        .toObject(),
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
      writer
        .writeQueryToStore({
          query,
          result: cloneDeep(result),
        })
        .toObject(),
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

    const writer = new StoreWriter({
      policies: new Policies({
        dataIdFromObject: getIdField,
      }),
    });

    expect(
      writer
        .writeQueryToStore({
          query,
          result: cloneDeep(result),
        })
        .toObject(),
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

    const writer = new StoreWriter({
      policies: new Policies({
        dataIdFromObject: getIdField,
      }),
    });

    expect(
      writer
        .writeQueryToStore({
          query,
          result: cloneDeep(result),
        })
        .toObject(),
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

    const normalized = writer.writeQueryToStore({
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

    const normalized = writer.writeQueryToStore({
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

    const writer = new StoreWriter({
      policies: new Policies({
        dataIdFromObject: getIdField,
      }),
    });

    const normalized = writer.writeQueryToStore({
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

    const normalized = writer.writeQueryToStore({
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

    const writer = new StoreWriter({
      policies: new Policies({
        dataIdFromObject: getIdField,
      }),
    });

    const normalized = writer.writeQueryToStore({
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

    const writer = new StoreWriter({
      policies: new Policies({
        dataIdFromObject: getIdField,
      }),
    });

    const normalized = writer.writeQueryToStore({
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

    const writer = new StoreWriter({
      policies: new Policies({
        dataIdFromObject: getIdField,
      }),
    });

    const normalized = writer.writeQueryToStore({
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

    const writer = new StoreWriter({
      policies: new Policies({
        dataIdFromObject: getIdField,
      }),
    });

    const store = writer.writeQueryToStore({
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

    const store2 = writer.writeQueryToStore({
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
      writer
        .writeQueryToStore({
          query,
          result: cloneDeep(result),
        })
        .toObject(),
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
      writer
        .writeQueryToStore({
          query,
          result: cloneDeep(result),
        })
        .toObject(),
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
        const writer = new StoreWriter({
          policies: new Policies({
            dataIdFromObject() {
              return '5';
            },
          }),
        });

        expect(
          writer.writeQueryToStore({
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
        writer
          .writeQueryToStore({
            result: data,
            query,
          })
          .toObject(),
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
          author: makeReference(policies.identify(data.author)[0]!),
        },
        [policies.identify(data.author)[0]!]: {
          firstName: data.author.firstName,
          id: data.author.id,
          __typename: data.author.__typename,
        },
      });
      expect(
        writer
          .writeQueryToStore({
            result: data,
            query,
          })
          .toObject(),
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
          author: makeReference(policies.identify(data.author)[0]!),
        },
        [policies.identify(data.author)[0]!]: {
          __typename: data.author.__typename,
          id: data.author.id,
          info: data.author.info,
        },
      });
      expect(
        writer
          .writeQueryToStore({
            result: data,
            query,
          })
          .toObject(),
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
    const expectedStoreWithoutId = defaultNormalizedCacheFactory({
      ROOT_QUERY: {
        __typename: 'Query',
        author: {
          firstName: 'John',
          lastName: 'Smith',
          __typename: 'Author',
        },
      },
    });
    const expectedStoreWithId = defaultNormalizedCacheFactory({
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

    const storeWithoutId = writer.writeQueryToStore({
      result: dataWithoutId,
      query: queryWithoutId,
    });
    expect(storeWithoutId.toObject()).toEqual(expectedStoreWithoutId.toObject());

    const storeWithId = writer.writeQueryToStore({
      result: dataWithId,
      query: queryWithId,
      store: storeWithoutId,
    });
    expect(storeWithId.toObject()).toEqual(expectedStoreWithId.toObject());
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
    const expStoreWithPlaceholder = defaultNormalizedCacheFactory({
      ROOT_QUERY: {
        __typename: 'Query',
        author: {
          hello: 'Foo',
          __typename: 'Placeholder',
        },
      },
    });
    const expStoreWithAuthor = defaultNormalizedCacheFactory({
      Author__129: {
        firstName: 'John',
        lastName: 'Smith',
        id: '129',
        __typename: 'Author',
      },
      ROOT_QUERY: {
        __typename: 'Query',
        author: makeReference('Author__129'),
      },
    });

    // write the first object, without an ID, placeholder
    const store = writer.writeQueryToStore({
      result: dataWithPlaceholder,
      query,
    });
    expect(store.toObject()).toEqual(expStoreWithPlaceholder.toObject());

    // replace with another one of different type with ID
    writer.writeQueryToStore({
      result: dataWithAuthor,
      query,
      store,
    });
    expect(store.toObject()).toEqual(expStoreWithAuthor.toObject());

    // and go back to the original:
    writer.writeQueryToStore({
      result: dataWithPlaceholder,
      query,
      store,
    });
    // Author__129 will remain in the store,
    // but will not be referenced by any of the fields,
    // hence we combine, and in that very order
    expect(store.toObject()).toEqual({
      ...expStoreWithAuthor.toObject(),
      ...expStoreWithPlaceholder.toObject(),
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
      writer.writeQueryToStore({
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
    const store = writer.writeQueryToStore({
      query,
      result: cloneDeep(result),
    });

    const newStore = writer.writeQueryToStore({
      query,
      result: cloneDeep(result),
      store: defaultNormalizedCacheFactory(store.toObject()),
    });

    Object.keys(store.toObject()).forEach(field => {
      expect((store as any).lookup(field)).toEqual((newStore as any).lookup(field));
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

    it('should write the result data without validating its shape when a fragment matcher is not provided', () => {
      const result = {
        todos: [
          {
            id: '1',
            name: 'Todo 1',
          },
        ],
      };

      const writer = new StoreWriter({
        policies: new Policies({
          dataIdFromObject: getIdField,
        }),
      });

      const newStore = writer.writeQueryToStore({
        query,
        result,
      });

      expect((newStore as any).lookup('1')).toEqual(result.todos[0]);
    });

    it('should warn when it receives the wrong data with non-union fragments', () => {
      const result = {
        todos: [
          {
            id: '1',
            name: 'Todo 1',
          },
        ],
      };

      const writer = new StoreWriter({
        policies: new Policies({
          dataIdFromObject: getIdField,
          possibleTypes: {},
        }),
      });

      expect(() => {
        writer.writeQueryToStore({
          query,
          result,
        });
      }).toThrowError(/Missing field 'description' /);
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

      const writer = new StoreWriter({
        policies: new Policies({
          dataIdFromObject: getIdField,
          possibleTypes: {
            Todo: ["ShoppingCartItem", "TaskItem"],
          },
        }),
      });

      expect(() => {
        writer.writeQueryToStore({
          query: queryWithInterface,
          result,
        });
      }).toThrowError(/Missing field 'price' /);
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

      const writer = new StoreWriter({
        policies: new Policies({
          dataIdFromObject: getIdField,
          possibleTypes: {},
        }),
      });

      expect(() => {
        writer.writeQueryToStore({
          query: addTypenameToDocument(query),
          result,
        });
      }).toThrowError(/Missing field '__typename' /);
    });

    it('should not warn if a field is null', () => {
      const result: any = {
        todos: null,
      };

      const writer = new StoreWriter({
        policies: new Policies({
          dataIdFromObject: getIdField,
        }),
      });

      const newStore = writer.writeQueryToStore({
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

      const writer = new StoreWriter({
        policies: new Policies({
          dataIdFromObject: getIdField,
        }),
      });

      const newStore = writer.writeQueryToStore({
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

    writer.writeQueryToStore({
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

    writer.writeQueryToStore({
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
    const writer = new StoreWriter({
      policies: new Policies({
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
    });

    writer.writeQueryToStore({
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

    writer.writeQueryToStore({
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

    writer.writeQueryToStore({
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

    writer.writeQueryToStore({
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

  it('should not keep reference when type of mixed inlined field changes to non-inlined field', () => {
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

    writer.writeQueryToStore({
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

    writer.writeQueryToStore({
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

    expect(cache.extract()).toEqual({
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
});
