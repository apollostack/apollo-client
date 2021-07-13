import React from 'react';
import { render, wait } from '@testing-library/react';
import gql from 'graphql-tag';
import { DocumentNode } from 'graphql';

import { ApolloClient } from '../../../../core';
import { ApolloProvider } from '../../../context';
import { InMemoryCache as Cache } from '../../../../cache';
import { ApolloLink } from '../../../../link/core';
import { itAsync, stripSymbols, mockSingleLink } from '../../../../testing';
import { graphql } from '../../graphql';
import { ChildProps } from '../../types';

describe('[queries] skip', () => {
  itAsync('allows you to skip a query without running it', (resolve, reject) => {
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
    interface Props {
      skip: boolean;
    }

    let queryExecuted = false;
    const Container = graphql<Props>(query, {
      skip: ({ skip }) => skip
    })(
      class extends React.Component<ChildProps<Props>> {
        componentDidUpdate() {
          queryExecuted = true;
        }
        render() {
          expect(this.props.data).toBeUndefined();
          return null;
        }
      }
    );

    render(
      <ApolloProvider client={client}>
        <Container skip={true} />
      </ApolloProvider>
    );

    let done = false;
    setTimeout(() => {
      if (!queryExecuted) {
        done = true;
        return;
      }
      fail(new Error('query ran even though skip present'));
    }, 25);

    return wait(() => expect(done).toBeTruthy()).then(resolve, reject);
  });

  itAsync('continues to not subscribe to a skipped query when props change', (resolve, reject) => {
    const query: DocumentNode = gql`
      query people {
        allPeople(first: 1) {
          people {
            name
          }
        }
      }
    `;

    const link = new ApolloLink((o, f) => {
      reject(new Error('query ran even though skip present'));
      return f ? f(o) : null;
    }).concat(mockSingleLink());
    // const oldQuery = link.query;
    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });

    interface Props {
      foo: number;
    }

    let done = false;
    const Container = graphql<Props>(query, { skip: true })(
      class extends React.Component<ChildProps<Props>> {
        componentDidUpdate() {
          done = true;
        }
        render() {
          return null;
        }
      }
    );

    class Parent extends React.Component<{}, { foo: number }> {
      state = { foo: 42 };

      componentDidMount() {
        this.setState({ foo: 43 });
      }
      render() {
        return <Container foo={this.state.foo} />;
      }
    }

    render(
      <ApolloProvider client={client}>
        <Parent />
      </ApolloProvider>
    );

    return wait(() => expect(done).toBeTruthy()).then(resolve, reject);
  });

  itAsync('supports using props for skipping which are used in options', (resolve, reject) => {
    const query: DocumentNode = gql`
      query people($id: ID!) {
        allPeople(first: $id) {
          people {
            id
          }
        }
      }
    `;

    const data = {
      allPeople: { people: { id: 1 } }
    };

    type Data = typeof data;

    const variables = { id: 1 };
    type Vars = typeof variables;

    const link = mockSingleLink({
      request: { query, variables },
      result: { data }
    });

    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });

    let count = 0;
    let renderCount = 0;

    interface Props {
      person: { id: number } | null;
    }
    const Container = graphql<Props, Data, Vars>(query, {
      skip: ({ person }) => !person,
      options: ({ person }) => ({
        variables: {
          id: person!.id
        }
      })
    })(
      class extends React.Component<ChildProps<Props, Data, Vars>> {
        componentDidUpdate() {
          const { props } = this;
          count++;
          if (count === 1) expect(props.data!.loading).toBeTruthy();
          if (count === 2)
            expect(stripSymbols(props.data!.allPeople)).toEqual(data.allPeople);
          if (count === 2) {
            expect(renderCount).toBe(3);
          }
        }
        render() {
          renderCount++;
          return null;
        }
      }
    );

    class Parent extends React.Component<
      {},
      { person: { id: number } | null }
    > {
      state = { person: null };

      componentDidMount() {
        this.setState({ person: { id: 1 } });
      }
      render() {
        return <Container person={this.state.person} />;
      }
    }

    render(
      <ApolloProvider client={client}>
        <Parent />
      </ApolloProvider>
    );

    return wait(() => expect(count).toBe(2)).then(resolve, reject);
  });

  itAsync("doesn't run options or props when skipped, including option.client", (resolve, reject) => {
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

    let queryExecuted = false;
    let optionsCalled = false;

    interface Props {
      skip: boolean;
      pollInterval?: number;
    }

    interface FinalProps {
      pollInterval: number;
      data?: {};
    }

    const Container = graphql<Props, {}, {}, FinalProps>(query, {
      skip: ({ skip }) => skip,
      options: props => {
        optionsCalled = true;
        return {
          pollInterval: props.pollInterval
        };
      },
      props: props => ({
        // intentionally incorrect
        pollInterval: (props as any).willThrowIfAccesed.pollInterval
      })
    })(
      class extends React.Component<FinalProps & Props> {
        componentDidUpdate() {
          queryExecuted = true;
        }
        render() {
          expect(this.props.data).toBeFalsy();
          return null;
        }
      }
    );

    render(
      <ApolloProvider client={client}>
        <Container skip={true} />
      </ApolloProvider>
    );

    let done = false;
    setTimeout(() => {
      if (!queryExecuted) {
        done = true;
        return;
      }
      if (optionsCalled) {
        fail(new Error('options ran even though skip present'));
        return;
      }
      fail(new Error('query ran even though skip present'));
    }, 25);

    return wait(() => expect(done).toBeTruthy()).then(resolve, reject);
  });

  itAsync("doesn't run options or props when skipped even if the component updates", (resolve, reject) => {
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
      result: {}
    });

    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });

    let queryWasSkipped = true;

    interface Props {
      foo: string;
    }

    let done = false;
    const Container = graphql<Props>(query, {
      skip: true,
      options: () => {
        queryWasSkipped = false;
        return {};
      },
      props: () => {
        queryWasSkipped = false;
        return {};
      }
    })(
      class extends React.Component<ChildProps<Props>> {
        componentDidUpdate() {
          expect(queryWasSkipped).toBeTruthy();
          done = true;
        }
        render() {
          return null;
        }
      }
    );

    class Parent extends React.Component<{}, { foo: string }> {
      state = { foo: 'bar' };
      componentDidMount() {
        this.setState({ foo: 'baz' });
      }
      render() {
        return <Container foo={this.state.foo} />;
      }
    }

    render(
      <ApolloProvider client={client}>
        <Parent />
      </ApolloProvider>
    );

    return wait(() => expect(done).toBeTruthy()).then(resolve, reject);
  });

  itAsync('allows you to skip a query without running it (alternate syntax)', (resolve, reject) => {
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

    let queryExecuted = false;
    const Container = graphql(query, { skip: true })(
      class extends React.Component<ChildProps> {
        componentDidUpdate() {
          queryExecuted = true;
        }
        render() {
          expect(this.props.data).toBeFalsy();
          return null;
        }
      }
    );

    render(
      <ApolloProvider client={client}>
        <Container />
      </ApolloProvider>
    );

    let done = false;
    setTimeout(() => {
      if (!queryExecuted) {
        done = true;
        return;
      }
      fail(new Error('query ran even though skip present'));
    }, 25);

    return wait(() => expect(done).toBeTruthy()).then(resolve, reject);
  });

  // test the case of skip:false -> skip:true -> skip:false to make sure things
  // are cleaned up properly
  itAsync('allows you to skip then unskip a query with top-level syntax', (resolve, reject) => {
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

    let hasSkipped = false;

    interface Props {
      skip: boolean;
      setSkip: (skip: boolean) => void;
    }

    const Container = graphql<Props>(query, { skip: ({ skip }) => skip })(
      class extends React.Component<ChildProps<Props>> {
        componentDidUpdate(prevProps: ChildProps<Props>) {
          if (this.props.skip) {
            hasSkipped = true;
            prevProps.setSkip(false);
          } else {
            if (!hasSkipped) {
              prevProps.setSkip(true);
            }
          }
        }
        render() {
          return null;
        }
      }
    );

    class Parent extends React.Component<any, any> {
      state = { skip: false };
      render() {
        return (
          <Container
            skip={this.state.skip}
            setSkip={skip => this.setState({ skip })}
          />
        );
      }
    }

    render(
      <ApolloProvider client={client}>
        <Parent />
      </ApolloProvider>
    );

    return wait(() => expect(hasSkipped).toBeTruthy()).then(resolve, reject);
  });

  itAsync('allows you to skip then unskip a query with new options (top-level syntax)', (resolve, reject) => {
    const query: DocumentNode = gql`
      query people($first: Int) {
        allPeople(first: $first) {
          people {
            name
          }
        }
      }
    `;
    const dataOne = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };
    const dataTwo = { allPeople: { people: [{ name: 'Leia Skywalker' }] } };

    type Data = typeof dataOne;
    type Vars = { first: number };

    const link = mockSingleLink(
      {
        request: { query, variables: { first: 1 } },
        result: { data: dataOne }
      },
      {
        request: { query, variables: { first: 2 } },
        result: { data: dataTwo }
      },
      {
        request: { query, variables: { first: 2 } },
        result: { data: dataTwo }
      }
    );
    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });

    let hasSkipped = false;

    interface Props {
      skip: boolean;
      first: number;
      setState: <K extends 'skip' | 'first'>(
        state: Pick<{ skip: boolean; first: number }, K>
      ) => void;
    }

    let done = false;
    const Container = graphql<Props, Data, Vars>(query, {
      skip: ({ skip }) => skip
    })(
      class extends React.Component<ChildProps<Props, Data, Vars>> {
        componentDidUpdate(prevProps: ChildProps<Props, Data, Vars>) {
          if (this.props.skip) {
            hasSkipped = true;
            // change back to skip: false, with a different variable
            prevProps.setState({ skip: false, first: 2 });
          } else {
            if (hasSkipped) {
              if (!this.props.data!.loading) {
                expect(stripSymbols(this.props.data!.allPeople)).toEqual(
                  dataTwo.allPeople
                );
                done = true;
              }
            } else {
              expect(stripSymbols(this.props.data!.allPeople)).toEqual(
                dataOne.allPeople
              );
              prevProps.setState({ skip: true });
            }
          }
        }
        render() {
          return null;
        }
      }
    );

    class Parent extends React.Component<{}, { skip: boolean; first: number }> {
      state = { skip: false, first: 1 };
      render() {
        return (
          <Container
            skip={this.state.skip}
            first={this.state.first}
            setState={state => this.setState(state)}
          />
        );
      }
    }

    render(
      <ApolloProvider client={client}>
        <Parent />
      </ApolloProvider>
    );

    return wait(() => expect(done).toBeTruthy()).then(resolve, reject);
  });

  it('allows you to skip then unskip a query with opts syntax', async () => {
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
    const nextData = { allPeople: { people: [{ name: 'Anakin Skywalker' }] } };
    const finalData = { allPeople: { people: [{ name: 'Darth Vader' }] } };

    let ranQuery = 0;

    const link = new ApolloLink((o, f) => {
      ranQuery++;
      return f ? f(o) : null;
    }).concat(
      mockSingleLink(
        {
          request: { query },
          result: { data },
        },
        {
          request: { query },
          result: { data: nextData },
        },
        {
          request: { query },
          result: { data: nextData },
        },
        {
          request: { query },
          result: { data: finalData },
        },
      )
    );

    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false }),
      queryDeduplication: false
    });

    let count = 0;
    const Container = graphql<any>(query, {
      options: {
        fetchPolicy: 'network-only',
        nextFetchPolicy: 'cache-first',
        notifyOnNetworkStatusChange: true
      },
      skip: ({ skip }) => skip
    })(
      class extends React.Component<any> {
        render() {
          expect(this.props.data?.error).toBeUndefined();

          switch (++count) {
            case 1:
              expect(this.props.data.loading).toBe(true);
              expect(ranQuery).toBe(0);
              break;
            case 2:
              // The first batch of data is fetched over the network, and
              // verified here, followed by telling the component we want to
              // skip running subsequent queries.
              expect(this.props.data.loading).toBe(false);
              expect(this.props.data.allPeople).toEqual(data.allPeople);
              expect(ranQuery).toBe(1);
              setTimeout(() => {
                this.props.setSkip(true);
              }, 10);
              break;
            case 3:
              // This render is triggered after setting skip to true. Now
              // let's set skip to false to re-trigger the query.
              expect(this.props.skip).toBe(true);
              expect(this.props.data).toBeUndefined();
              expect(ranQuery).toBe(1);
              setTimeout(() => {
                this.props.setSkip(false);
              }, 10);
              break;
            case 4:
              expect(this.props.skip).toBe(false);
              expect(this.props.data!.loading).toBe(true);
              expect(this.props.data.allPeople).toEqual(data.allPeople);
              expect(ranQuery).toBe(2);
              break;
            case 5:
              expect(this.props.skip).toBe(false);
              expect(this.props.data!.loading).toBe(false);
              expect(this.props.data.allPeople).toEqual(nextData.allPeople);
              expect(ranQuery).toBe(3);
              // Since the `nextFetchPolicy` was set to `cache-first`, our
              // query isn't loading as it's able to find the result of the
              // query directly from the cache. Let's trigger a refetch
              // to manually load the next batch of data.
              setTimeout(() => {
                this.props.data.refetch();
              }, 10);
              break;
            case 6:
              expect(this.props.skip).toBe(false);
              expect(this.props.data!.loading).toBe(true);
              expect(this.props.data.allPeople).toEqual(nextData.allPeople);
              expect(ranQuery).toBe(4);
              break;
            case 7:
              // The next batch of data has loaded.
              expect(this.props.skip).toBe(false);
              expect(this.props.data!.loading).toBe(false);
              expect(this.props.data.allPeople).toEqual(finalData.allPeople);
              expect(ranQuery).toBe(4);
              break;
            default:
              throw new Error(`too many renders (${count})`);
          }
          return null;
        }
      }
    );

    class Parent extends React.Component<{}, { skip: boolean }> {
      state = { skip: false };
      render() {
        return (
          <Container
            skip={this.state.skip}
            setSkip={(skip: boolean) => this.setState({ skip })}
          />
        );
      }
    }

    render(
      <ApolloProvider client={client}>
        <Parent />
      </ApolloProvider>
    );

    await wait(() => {
      expect(count).toEqual(7);
    });
  });

  it('removes the injected props if skip becomes true', async () => {
    let count = 0;
    const query: DocumentNode = gql`
      query people($first: Int) {
        allPeople(first: $first) {
          people {
            name
          }
        }
      }
    `;

    const data1 = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };
    const variables1 = { first: 1 };

    const data2 = { allPeople: { people: [{ name: 'Leia Skywalker' }] } };
    const variables2 = { first: 2 };

    const data3 = { allPeople: { people: [{ name: 'Anakin Skywalker' }] } };
    const variables3 = { first: 3 };

    type Data = typeof data1;
    type Vars = typeof variables1;

    const link = mockSingleLink(
      { request: { query, variables: variables1 }, result: { data: data1 } },
      { request: { query, variables: variables2 }, result: { data: data2 } },
      { request: { query, variables: variables3 }, result: { data: data3 } }
    );

    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });

    const Container = graphql<Vars, Data>(query, {
      skip: () => count === 1
    })(
      class extends React.Component<ChildProps<Vars, Data>> {
        componentDidUpdate() {
          const { data } = this.props;
          // loading is true, but data still there
          if (count === 0)
            expect(stripSymbols(data!.allPeople)).toEqual(data1.allPeople);
          if (count === 1) expect(data).toBeUndefined();
          if (count === 2 && !data!.loading) {
            expect(stripSymbols(data!.allPeople)).toEqual(data3.allPeople);
          }
        }
        render() {
          return null;
        }
      }
    );

    class ChangingProps extends React.Component<{}, { first: number }> {
      state = { first: 1 };
      componentDidMount() {
        setTimeout(() => {
          count++;
          this.setState({ first: 2 });

          setTimeout(() => {
            count++;
            this.setState({ first: 3 });
          });
        });
      }

      render() {
        return <Container first={this.state.first} />;
      }
    }

    render(
      <ApolloProvider client={client}>
        <ChangingProps />
      </ApolloProvider>
    );

    await wait(() => {
      expect(count).toEqual(2);
    });
  });

  itAsync('allows you to unmount a skipped query', (resolve, reject) => {
    const query: DocumentNode = gql`
      query people {
        allPeople(first: 1) {
          people {
            name
          }
        }
      }
    `;
    const link = mockSingleLink();
    const client = new ApolloClient({
      link,
      cache: new Cache({ addTypename: false })
    });

    interface Props {
      hide: () => void;
    }

    let done = false;
    const Container = graphql<Props>(query, {
      skip: true
    })(
      class extends React.Component<ChildProps<Props>> {
        componentDidMount() {
          this.props.hide();
        }
        componentWillUnmount() {
          done = true;
        }
        render() {
          return null;
        }
      }
    );

    class Hider extends React.Component<{}, { hide: boolean }> {
      state = { hide: false };
      render() {
        if (this.state.hide) {
          return null;
        }
        return <Container hide={() => this.setState({ hide: true })} />;
      }
    }

    render(
      <ApolloProvider client={client}>
        <Hider />
      </ApolloProvider>
    );

    return wait(() => expect(done).toBeTruthy()).then(resolve, reject);
  });
});
