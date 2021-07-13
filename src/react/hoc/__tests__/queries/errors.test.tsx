import React from 'react';
import { render, wait } from '@testing-library/react';
import gql from 'graphql-tag';
import { withState } from 'recompose';
import { DocumentNode } from 'graphql';

import { ApolloClient } from '../../../../core';
import { ApolloProvider } from '../../../context';
import { InMemoryCache as Cache } from '../../../../cache';
import { QueryResult } from '../../../types/types';
import { itAsync, stripSymbols, mockSingleLink } from '../../../../testing';
import { Query } from '../../../components/Query';
import { graphql } from '../../graphql';
import { ChildProps, DataValue } from '../../types';

describe('[queries] errors', () => {
  let error: typeof console.error;
  beforeEach(() => {
    error = console.error;
    console.error = jest.fn(() => {});
  });
  afterEach(() => {
    console.error = error;
  });

  // errors
  itAsync('does not swallow children errors', (resolve, reject) => {
    const query: DocumentNode = gql`
      query people {
        allPeople(first: 1) {
          people {
            name
          }
        }
      }
    `;
    const data = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };
    const link = mockSingleLink({
      request: { query },
      result: { data }
    });
    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });

    class ErrorBoundary extends React.Component {
      componentDidCatch(e: Error) {
        expect(e.message).toMatch(/bar is not a function/);
      }

      render() {
        return this.props.children;
      }
    }
    let bar: any;
    const ContainerWithData = graphql(query)(() => {
      bar(); // this will throw
      return null;
    });

    render(
      <ApolloProvider client={client}>
        <ErrorBoundary>
          <ContainerWithData />
        </ErrorBoundary>
      </ApolloProvider>
    );

    return wait().then(resolve, reject);
  });

  itAsync('can unmount without error', (resolve, reject) => {
    const query: DocumentNode = gql`
      query people {
        allPeople(first: 1) {
          people {
            name
          }
        }
      }
    `;
    const data = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };
    const link = mockSingleLink({
      request: { query },
      result: { data }
    });
    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });

    const ContainerWithData = graphql(query)(() => null);

    const { unmount } = render(
      <ApolloProvider client={client}>
        <ContainerWithData />
      </ApolloProvider>
    ) as any;

    try {
      unmount();
    } catch (e) {
      throw new Error(e);
    }

    return wait().then(resolve, reject);
  });

  itAsync('passes any GraphQL errors in props', (resolve, reject) => {
    const query: DocumentNode = gql`
      query people {
        allPeople(first: 1) {
          people {
            name
          }
        }
      }
    `;
    const link = mockSingleLink({
      request: { query },
      error: new Error('boo')
    });
    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });

    const ErrorContainer = graphql(query)(
      class extends React.Component<ChildProps> {
        componentDidUpdate() {
          const { data } = this.props;
          expect(data!.error).toBeTruthy();
          expect(data!.error!.networkError).toBeTruthy();
        }
        render() {
          return null;
        }
      }
    );

    render(
      <ApolloProvider client={client}>
        <ErrorContainer />
      </ApolloProvider>
    );

    return wait().then(resolve, reject);
  });

  describe('uncaught exceptions', () => {
    const consoleWarn = console.warn;
    beforeAll(() => {
      console.warn = () => null;
    });

    afterAll(() => {
      console.warn = consoleWarn;
    });

    let unhandled: any[] = [];
    function handle(reason: any) {
      unhandled.push(reason);
    }
    beforeEach(() => {
      unhandled = [];
      process.on('unhandledRejection', handle);
    });
    afterEach(() => {
      process.removeListener('unhandledRejection', handle);
    });

    itAsync('does not log when you change variables resulting in an error', (resolve, reject) => {
      const query: DocumentNode = gql`
        query people($var: Int) {
          allPeople(first: $var) {
            people {
              name
            }
          }
        }
      `;
      const var1 = { var: 1 };
      const data = { allPeople: { people: { name: 'Luke Skywalker' } } };
      const var2 = { var: 2 };
      const link = mockSingleLink(
        {
          request: { query, variables: var1 },
          result: { data }
        },
        {
          request: { query, variables: var2 },
          error: new Error('boo')
        }
      );
      const client = new ApolloClient({
        link,
        cache: new Cache({ addTypename: false })
      });

      type Data = typeof data;
      type Vars = typeof var1;

      interface Props extends Vars {
        var: number;
        setVar: (val: number) => number;
      }

      let iteration = 0;
      let done = false;
      const ErrorContainer = withState('var', 'setVar', 1)(
        graphql<Props, Data, Vars>(query)(
          class extends React.Component<ChildProps<Props, Data, Vars>> {
            componentDidUpdate() {
              const { props } = this;
              iteration += 1;
              if (iteration === 1) {
                // initial loading state is done, we have data
                expect(stripSymbols(props.data!.allPeople)).toEqual(
                  data.allPeople
                );
                props.setVar(2);
              } else if (iteration === 2) {
                // variables have changed, wee are loading again but also have data
                expect(props.data!.loading).toBeTruthy();
              } else if (iteration === 3) {
                // the second request had an error!
                expect(props.data!.error).toBeTruthy();
                expect(props.data!.error!.networkError).toBeTruthy();
                // // We need to set a timeout to ensure the unhandled rejection is swept up
                setTimeout(() => {
                  expect(unhandled.length).toEqual(0);
                  done = true;
                });
              }
            }
            render() {
              return null;
            }
          }
        )
      );

      render(
        <ApolloProvider client={client}>
          <ErrorContainer />
        </ApolloProvider>
      );

      return wait(() => expect(done).toBeTruthy()).then(resolve, reject);
    });
  });

  it('will not log a warning when there is an error that is not caught in the render method when using query', () =>
    new Promise<void>((resolve, reject) => {
      const query: DocumentNode = gql`
        query people {
          allPeople(first: 1) {
            people {
              name
            }
          }
        }
      `;

      interface Data {
        allPeople: {
          people: { name: string }[];
        };
      }

      const link = mockSingleLink({
        request: { query },
        error: new Error('oops')
      });
      const client = new ApolloClient({
        link,
        cache: new Cache({ addTypename: false })
      });

      const origError = console.error;
      const errorMock = jest.fn();
      console.error = errorMock;

      let renderCount = 0;
      @graphql<{}, Data>(query)
      class UnhandledErrorComponent extends React.Component<
        ChildProps<{}, Data>
      > {
        render(): React.ReactNode {
          try {
            switch (renderCount++) {
              case 0:
                expect(this.props.data!.loading).toEqual(true);
                break;
              case 1:
                // Noop. Don’t handle the error so a warning will be logged to the console.
                expect(renderCount).toBe(2);
                expect(errorMock.mock.calls.length).toBe(0);
                resolve();
                break;
              default:
                throw new Error('Too many renders.');
            }
          } catch (error) {
            reject(error);
          } finally {
            console.error = origError;
          }
          return null;
        }
      }

      render(
        <ApolloProvider client={client}>
          <UnhandledErrorComponent />
        </ApolloProvider>
      );
    }));

  itAsync('passes any cached data when there is a GraphQL error', (resolve, reject) => {
    const query: DocumentNode = gql`
      query people {
        allPeople(first: 1) {
          people {
            name
          }
        }
      }
    `;
    const data = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };
    type Data = typeof data;
    const link = mockSingleLink(
      { request: { query }, result: { data } },
      { request: { query }, error: new Error('No Network Connection') }
    );
    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });

    let count = 0;
    const Container = graphql<{}, Data>(query, {
      options: { notifyOnNetworkStatusChange: true }
    })(
      class extends React.Component<ChildProps<{}, Data>> {
        componentDidUpdate() {
          const { props } = this;
          try {
            switch (count++) {
              case 0:
                expect(stripSymbols(props.data!.allPeople)).toEqual(
                  data.allPeople
                );
                setTimeout(() => {
                  props.data!.refetch().catch(() => null);
                });
                break;
              case 1:
                expect(props.data!.loading).toBeTruthy();
                expect(stripSymbols(props.data!.allPeople)).toEqual(
                  data.allPeople
                );
                break;
              case 2:
                expect(props.data!.loading).toBeFalsy();
                expect(props.data!.error).toBeTruthy();
                expect(stripSymbols(props.data!.allPeople)).toEqual(
                  data.allPeople
                );
                break;
              default:
                throw new Error('Unexpected fall through');
            }
          } catch (e) {
            reject(e);
          }
        }

        render() {
          return null;
        }
      }
    );

    render(
      <ApolloProvider client={client}>
        <Container />
      </ApolloProvider>
    );

    return wait(() => expect(count).toBe(3)).then(resolve, reject);
  });

  itAsync('can refetch after there was a network error', (resolve, reject) => {
    const query: DocumentNode = gql`
      query somethingelse {
        allPeople(first: 1) {
          people {
            name
          }
        }
      }
    `;
    const data = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };
    const dataTwo = { allPeople: { people: [{ name: 'Princess Leia' }] } };

    type Data = typeof data;
    const link = mockSingleLink(
      { request: { query }, result: { data } },
      { request: { query }, error: new Error('This is an error!') },
      { request: { query }, result: { data: dataTwo } }
    );
    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });

    let count = 0;
    const noop = () => null;
    const Container = graphql<{}, Data>(query, {
      options: { notifyOnNetworkStatusChange: true }
    })(
      class extends React.Component<ChildProps<{}, Data>> {
        componentDidUpdate() {
          const { props } = this;
          try {
            switch (count++) {
              case 0:
                props
                  .data!.refetch()
                  .then(() => {
                    reject('Expected error value on first refetch.');
                  })
                  .catch(noop);
                break;
              case 1:
                expect(props.data!.loading).toBeTruthy();
                break;
              case 2:
                expect(props.data!.loading).toBeFalsy();
                expect(props.data!.error).toBeTruthy();
                props
                  .data!.refetch()
                  .then(noop)
                  .catch(() => {
                    reject('Expected good data on second refetch.');
                  });
                break;
              case 3:
                expect(props.data!.loading).toBeTruthy();
                break;
              case 4:
                expect(props.data!.loading).toBeFalsy();
                expect(props.data!.error).toBeFalsy();
                expect(stripSymbols(props.data!.allPeople)).toEqual(
                  dataTwo.allPeople
                );
                break;
              default:
                throw new Error('Unexpected fall through');
            }
          } catch (e) {
            reject(e);
          }
        }

        render() {
          return null;
        }
      }
    );

    render(
      <ApolloProvider client={client}>
        <Container />
      </ApolloProvider>
    );

    return wait(() => expect(count).toBe(5)).then(resolve, reject);
  });

  itAsync('does not throw/console.err an error after a component that received a network error is unmounted', (resolve, reject) => {
    const query: DocumentNode = gql`
      query somethingelse {
        allPeople(first: 1) {
          people {
            name
          }
        }
      }
    `;
    const data = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };

    type Data = typeof data;
    const link = mockSingleLink(
      { request: { query }, result: { data } },
      { request: { query }, error: new Error('This is an error!') }
    );

    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });
    let count = 0;
    const noop = () => null;

    interface ContainerOwnProps {
      hideContainer: Function;
    }

    interface QueryChildProps {
      data: DataValue<Data>;
      hideContainer: Function;
    }

    let done = false;
    const Container = graphql<ContainerOwnProps, Data, {}, QueryChildProps>(
      query,
      {
        options: { notifyOnNetworkStatusChange: true },
        props: something => {
          return {
            data: something.data!,
            hideContainer: something!.ownProps.hideContainer
          };
        }
      }
    )(
      class extends React.Component<ChildProps<QueryChildProps, Data>> {
        componentDidUpdate() {
          const { props } = this;
          try {
            switch (count++) {
              case 0:
                props
                  .data!.refetch()
                  .then(() => {
                    reject('Expected error value on first refetch.');
                  })
                  .catch(noop);
                break;
              case 2:
                expect(props.data!.loading).toBeFalsy();
                expect(props.data!.error).toBeTruthy();
                const origError = console.error;
                const errorMock = jest.fn();
                console.error = errorMock;
                props.hideContainer();
                setTimeout(() => {
                  expect(errorMock.mock.calls.length).toEqual(0);
                  console.error = origError;
                  done = true;
                }, 100);
                break;
              default:
                if (count < 2) {
                  throw new Error('Unexpected fall through');
                }
            }
          } catch (err) {
            reject(err);
          }
        }
        render() {
          return null;
        }
      }
    );

    class Switcher extends React.Component<any, any> {
      constructor(props: any) {
        super(props);
        this.state = {
          showContainer: true
        };
      }
      render() {
        const {
          state: { showContainer }
        } = this;
        if (showContainer) {
          return (
            <Container
              hideContainer={() => this.setState({ showContainer: false })}
            />
          );
        }
        return null;
      }
    }

    render(
      <ApolloProvider client={client}>
        <Switcher />
      </ApolloProvider>
    );

    return wait(() => expect(done).toBeTruthy()).then(resolve, reject);
  });

  itAsync('correctly sets loading state on remount after a network error', (resolve, reject) => {
    const query: DocumentNode = gql`
      query somethingelse {
        allPeople(first: 1) {
          people {
            name
          }
        }
      }
    `;
    const data = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };
    const dataTwo = { allPeople: { people: [{ name: 'Princess Leia' }] } };

    type Data = typeof data;
    const link = mockSingleLink(
      { request: { query }, error: new Error('This is an error!') },
      { request: { query }, result: { data: dataTwo } }
    );
    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });

    let count = 0;
    type ContainerOwnProps = { toggle: () => void };
    const Container = graphql<ContainerOwnProps, Data>(query, {
      options: { notifyOnNetworkStatusChange: true }
    })(
      class extends React.Component<ChildProps<ContainerOwnProps, Data>> {
        render() {
          switch (count) {
            case 0:
              expect(this.props.data!.loading).toBe(true);
              break;
            case 1:
              expect(this.props.data!.loading).toBe(false);
              expect(this.props.data!.error!.networkError!.message).toMatch(
                /This is an error/
              );
              // unmount this component
              setTimeout(() => {
                this.props.toggle();
              }, 0);
              setTimeout(() => {
                // remount after 50 ms
                this.props.toggle();
              }, 50);
              break;
            case 2:
              expect(this.props.data!.loading).toBe(true);
              break;
            case 3:
              expect(this.props.data!.loading).toBe(false);
              expect(this.props.data!.allPeople).toEqual(dataTwo.allPeople);
              break;
            default:
              throw new Error('Too many renders.');
          }
          count += 1;

          return null;
        }
      }
    );

    type Toggle = () => void;
    type OwnProps = { children: (toggle: Toggle) => any };
    class Manager extends React.Component<OwnProps, { show: boolean }> {
      constructor(props: any) {
        super(props);
        this.state = { show: true };
      }
      render() {
        if (!this.state.show) return null;
        return this.props.children(() =>
          this.setState(({ show }) => ({ show: !show }))
        );
      }
    }

    render(
      <ApolloProvider client={client}>
        <Manager>{(toggle: Toggle) => <Container toggle={toggle} />}</Manager>
      </ApolloProvider>
    );

    return wait(() => expect(count).toBe(4)).then(resolve, reject);
  });

  describe('errorPolicy', () => {
    itAsync('passes any GraphQL errors in props along with data', (resolve, reject) => {
      const query: DocumentNode = gql`
        query people {
          allPeople(first: 1) {
            people {
              name
            }
          }
        }
      `;
      const link = mockSingleLink({
        request: { query },
        result: {
          data: {
            allPeople: {
              people: null
            }
          },
          errors: [new Error('this is an error')]
        }
      });

      const client = new ApolloClient({
        link,
        cache: new Cache({ addTypename: false })
      });

      const ErrorContainer = graphql(query, {
        options: { errorPolicy: 'all' }
      })(
        class extends React.Component<ChildProps> {
          componentDidUpdate() {
            const { data } = this.props;
            expect(data!.error).toBeTruthy();
            expect(data!.error!.graphQLErrors[0].message).toEqual(
              'this is an error'
            );
            expect(data).toMatchObject({ allPeople: { people: null } });
          }
          render() {
            return null;
          }
        }
      );

      render(
        <ApolloProvider client={client}>
          <ErrorContainer />
        </ApolloProvider>
      );

      return wait().then(resolve, reject);
    });

    itAsync('passes any GraphQL errors in props along with data [component]', (resolve, reject) => {
      const query: DocumentNode = gql`
        query people {
          allPeople(first: 1) {
            people {
              name
            }
          }
        }
      `;
      const link = mockSingleLink({
        request: { query },
        result: {
          data: {
            allPeople: {
              people: null
            }
          },
          errors: [new Error('this is an error')]
        }
      });

      const client = new ApolloClient({
        link,
        cache: new Cache({ addTypename: false })
      });

      class ErrorContainer extends React.Component<QueryResult> {
        componentDidUpdate() {
          const { props } = this;
          expect(props.error).toBeTruthy();
          expect(props.error!.graphQLErrors[0].message).toEqual(
            'this is an error'
          );
          expect(props.data!.allPeople!).toMatchObject({ people: null });
        }
        render() {
          return null;
        }
      }

      render(
        <ApolloProvider client={client}>
          <Query query={query} errorPolicy="all">
            {(props: any) => <ErrorContainer {...props} />}
          </Query>
        </ApolloProvider>
      );

      return wait().then(resolve, reject);
    });
  });
});
