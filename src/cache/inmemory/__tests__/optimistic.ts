import gql from 'graphql-tag';

import { InMemoryCache } from '../inMemoryCache';

describe('optimistic cache layers', () => {
  it('return === results for repeated reads', () => {
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

    const query = gql`
      {
        book {
          title
          author {
            name
          }
        }
      }
    `;

    function readOptimistic(cache: InMemoryCache) {
      return cache.readQuery<{ book: any }>({ query }, true);
    }

    function readRealistic(cache: InMemoryCache) {
      return cache.readQuery<{ book: any }>({ query }, false);
    }

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
        },
      },
    });

    const result1984 = readOptimistic(cache);
    expect(result1984).toEqual({
      book: {
        __typename: 'Book',
        title: '1984',
        author: {
          __typename: 'Author',
          name: 'George Orwell',
        },
      },
    });

    expect(result1984).toBe(readOptimistic(cache));
    expect(result1984).toBe(readRealistic(cache));

    let result2666InTransaction: ReturnType<typeof readOptimistic> | null = null;
    cache.performTransaction(proxy => {
      expect(readOptimistic(cache)).toEqual(result1984);

      proxy.writeQuery({
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

      result2666InTransaction = readOptimistic(proxy);
      expect(result2666InTransaction).toEqual({
        book: {
          __typename: 'Book',
          title: '2666',
          author: {
            __typename: 'Author',
            name: 'Roberto Bolaño',
          },
        },
      });
    }, 'first');

    expect(readOptimistic(cache)).toBe(result2666InTransaction);

    expect(result1984).toBe(readRealistic(cache));

    let resultCatch22: ReturnType<typeof readOptimistic> | null = null;
    cache.performTransaction(proxy => {
      proxy.writeQuery({
        query,
        data: {
          book: {
            __typename: 'Book',
            isbn: '1451626657',
            title: 'Catch-22',
            author: {
              __typename: 'Author',
              name: 'Joseph Heller',
            },
          },
        },
      });

      resultCatch22 = readOptimistic(proxy);
      expect(resultCatch22).toEqual({
        book: {
          __typename: 'Book',
          title: 'Catch-22',
          author: {
            __typename: 'Author',
            name: 'Joseph Heller',
          },
        },
      });
    }, 'second');

    expect(readOptimistic(cache)).toBe(resultCatch22);

    expect(result1984).toBe(readRealistic(cache));

    cache.removeOptimistic('first');

    expect(readOptimistic(cache)).toBe(resultCatch22);

    // Write a new book to the root Query.book field, which should not affect
    // the 'second' optimistic layer that is still applied.
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
          },
        },
      },
    });

    expect(readOptimistic(cache)).toBe(resultCatch22);

    const resultF451 = readRealistic(cache);
    expect(resultF451).toEqual({
      book: {
        __typename: 'Book',
        title: 'Fahrenheit 451',
        author: {
          __typename: 'Author',
          name: 'Ray Bradbury',
        },
      },
    });

    cache.removeOptimistic('second');

    expect(resultF451).toBe(readRealistic(cache));
    expect(resultF451).toBe(readOptimistic(cache));

    expect(cache.extract(true)).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        book: { __ref: 'Book:9781451673319' },
      },
      'Book:1980719802': {
        title: '1984',
        author: { __ref: 'Author:George Orwell' },
        __typename: 'Book',
      },
      'Book:9781451673319': {
        title: 'Fahrenheit 451',
        author: { __ref: 'Author:Ray Bradbury' },
        __typename: 'Book',
      },
      'Author:George Orwell': {
        __typename: 'Author',
        name: 'George Orwell',
      },
      'Author:Ray Bradbury': {
        __typename: 'Author',
        name: 'Ray Bradbury',
      },
    });
  });

  it('dirties appropriate IDs when optimistic layers are removed', () => {
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

    type Q = {
      books: any[];
    };

    const query = gql`
      {
        books {
          title
          subtitle
        }
      }
    `;

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
        books: [eagerBookData, spinelessBookData],
      },
    });

    expect(cache.extract(true)).toEqual({
      ROOT_QUERY: {
        __typename: "Query",
        books: [{ __ref: 'Book:1603589082' }, { __ref: 'Book:0735211280' }],
      },
      'Book:1603589082': {
        title: 'Eager',
        subtitle: eagerBookData.subtitle,
        __typename: 'Book',
      },
      'Book:0735211280': {
        title: 'Spineless',
        subtitle: spinelessBookData.subtitle,
        __typename: 'Book',
      },
    });

    function read() {
      return cache.readQuery<Q>({ query }, true)!;
    }

    const result = read();
    expect(result).toEqual({
      books: [
        {
          __typename: 'Book',
          title: 'Eager',
          subtitle: 'The Surprising, Secret Life of Beavers and Why They Matter',
        },
        {
          __typename: 'Book',
          title: 'Spineless',
          subtitle: 'The Science of Jellyfish and the Art of Growing a Backbone',
        },
      ],
    });
    expect(read()).toBe(result);

    const bookAuthorNameFragment = gql`
      fragment BookAuthorName on Book {
        author {
          name
        }
      }
    `;

    cache.writeFragment({
      id: 'Book:0735211280',
      fragment: bookAuthorNameFragment,
      data: {
        author: spinelessBookData.author,
      },
    });

    // Adding an author doesn't change the structure of the original result,
    // because the original query did not ask for author information.
    const resultWithSpinlessAuthor = read();
    expect(resultWithSpinlessAuthor).toEqual(result);
    expect(resultWithSpinlessAuthor).toBe(result);
    expect(resultWithSpinlessAuthor.books[0]).toBe(result.books[0]);
    expect(resultWithSpinlessAuthor.books[1]).toBe(result.books[1]);

    cache.recordOptimisticTransaction(proxy => {
      proxy.writeFragment({
        id: 'Book:1603589082',
        fragment: bookAuthorNameFragment,
        data: {
          author: eagerBookData.author,
        },
      });
    }, 'eager author');

    expect(read()).toEqual(result);

    const queryWithAuthors = gql`
      {
        books {
          title
          subtitle
          author {
            name
          }
        }
      }
    `;

    function readWithAuthors(optimistic = true) {
      return cache.readQuery<Q>({
        query: queryWithAuthors,
      }, optimistic)!;
    }

    function withoutISBN(data: any) {
      return JSON.parse(JSON.stringify(
        data,
        (key, value) => {
          if (key === 'isbn') return;
          return value;
        },
      ));
    }

    const resultWithTwoAuthors = readWithAuthors();
    expect(resultWithTwoAuthors).toEqual({
      books: [
        withoutISBN(eagerBookData),
        withoutISBN(spinelessBookData),
      ],
    });

    const buzzBookData = {
      __typename: 'Book',
      isbn: '0465052614',
      title: 'Buzz',
      subtitle: 'The Nature and Necessity of Bees',
      author: {
        __typename: 'Author',
        name: 'Thor Hanson',
      },
    };

    cache.recordOptimisticTransaction(proxy => {
      proxy.writeQuery({
        query: queryWithAuthors,
        data: {
          books: [
            eagerBookData,
            spinelessBookData,
            buzzBookData,
          ],
        },
      });
    }, 'buzz book');

    const resultWithBuzz = readWithAuthors();

    expect(resultWithBuzz).toEqual({
      books: [
        withoutISBN(eagerBookData),
        withoutISBN(spinelessBookData),
        withoutISBN(buzzBookData),
      ],
    });
    expect(resultWithBuzz.books[0]).toEqual(resultWithTwoAuthors.books[0]);
    expect(resultWithBuzz.books[1]).toEqual(resultWithTwoAuthors.books[1]);

    // Before removing the Buzz optimistic layer from the cache, write the same
    // data to the root layer of the cache.
    cache.writeQuery({
      query: queryWithAuthors,
      data: {
        books: [eagerBookData, spinelessBookData, buzzBookData],
      },
    });

    expect(readWithAuthors()).toBe(resultWithBuzz);

    function readSpinelessFragment() {
      return cache.readFragment<{ author: any }>(
        {
          id: 'Book:' + spinelessBookData.isbn,
          fragment: bookAuthorNameFragment,
        },
        true,
      );
    }

    const spinelessBeforeRemovingBuzz = readSpinelessFragment();
    cache.removeOptimistic('buzz book');
    const spinelessAfterRemovingBuzz = readSpinelessFragment();
    expect(spinelessBeforeRemovingBuzz).toEqual(spinelessAfterRemovingBuzz);
    expect(spinelessBeforeRemovingBuzz).toBe(spinelessAfterRemovingBuzz);

    const resultAfterRemovingBuzzLayer = readWithAuthors();
    expect(resultAfterRemovingBuzzLayer).toEqual(resultWithBuzz);
    expect(resultAfterRemovingBuzzLayer).toBe(resultWithBuzz);
    resultWithTwoAuthors.books.forEach((book, i) => {
      expect(book).toEqual(resultAfterRemovingBuzzLayer.books[i]);
      expect(book).toBe(resultAfterRemovingBuzzLayer.books[i]);
    });

    const nonOptimisticResult = readWithAuthors(false);
    expect(nonOptimisticResult).toEqual(resultWithBuzz);
    cache.removeOptimistic('eager author');
    const resultWithoutOptimisticLayers = readWithAuthors();
    expect(resultWithoutOptimisticLayers).toBe(nonOptimisticResult);
  });
});
