import * as React from 'react';
import { DocumentNode } from 'graphql';
import hoistNonReactStatics from 'hoist-non-react-statics';

import { parser } from '../parser';
import { DefaultContext } from '../../core/types';
import {
  BaseMutationOptions,
  MutationFunction,
  MutationResult
} from '../types/types';
import { Mutation } from '../components';

import {
  defaultMapPropsToOptions,
  getDisplayName,
  calculateVariablesFromProps,
  GraphQLBase
} from './hoc-utils';
import { OperationOption, OptionProps, MutateProps } from './types';
import { ApolloCache } from '../../core';

export function withMutation<
  TProps extends TGraphQLVariables | {} = {},
  TData extends Record<string, any> = {},
  TGraphQLVariables = {},
  TChildProps = MutateProps<TData, TGraphQLVariables>,
  TContext = DefaultContext,
  TCache extends ApolloCache<any> = ApolloCache<any>,
>(
  document: DocumentNode,
  operationOptions: OperationOption<
    TProps,
    TData,
    TGraphQLVariables,
    TChildProps
  > = {}
) {
  // this is memoized so if coming from `graphql` there is nearly no extra cost
  const operation = parser(document);
  // extract options

  const {
    options = defaultMapPropsToOptions,
    alias = 'Apollo'
  } = operationOptions;

  let mapPropsToOptions = options as (props: any) => BaseMutationOptions<TData, TGraphQLVariables, TContext, TCache>;
  if (typeof mapPropsToOptions !== 'function')
    mapPropsToOptions = () => options as BaseMutationOptions<TData, TGraphQLVariables, TContext, TCache>;

  return (
    WrappedComponent: React.ComponentType<TProps & TChildProps>
  ): React.ComponentClass<TProps> => {
    const graphQLDisplayName = `${alias}(${getDisplayName(WrappedComponent)})`;
    class GraphQL extends GraphQLBase<TProps, TChildProps> {
      static displayName = graphQLDisplayName;
      static WrappedComponent = WrappedComponent;
      render() {
        let props = this.props as TProps;
        const opts = mapPropsToOptions(props) as BaseMutationOptions<TData, TGraphQLVariables, TContext, TCache>;

        if (operationOptions.withRef) {
          this.withRef = true;
          props = Object.assign({}, props, {
            ref: this.setWrappedInstance
          });
        }
        if (!opts.variables && operation.variables.length > 0) {
          opts.variables = calculateVariablesFromProps(operation, props) as TGraphQLVariables;
        }

        return (
          <Mutation ignoreResults {...opts} mutation={document}>
            {(
              mutate: MutationFunction<TData, TGraphQLVariables>,
              { data, ...r }: MutationResult<TData>
            ) => {
              // the HOC's historically hoisted the data from the execution result
              // up onto the result since it was passed as a nested prop
              // we massage the Mutation component's shape here to replicate that
              // this matches the query HoC
              const result = Object.assign(r, data || {});
              const name = operationOptions.name || 'mutate';
              const resultName = operationOptions.name
                ? `${name}Result`
                : 'result';
              let childProps = ({
                [name]: mutate,
                [resultName]: result
              } as any) as TChildProps;
              if (operationOptions.props) {
                const newResult: OptionProps<
                  TProps,
                  TData,
                  TGraphQLVariables
                > = {
                  [name]: mutate,
                  [resultName]: result,
                  ownProps: props
                };
                childProps = operationOptions.props(newResult) as any;
              }

              return <WrappedComponent {...props} {...childProps} />;
            }}
          </Mutation>
        );
      }
    }

    // Make sure we preserve any custom statics on the original component.
    return hoistNonReactStatics(GraphQL, WrappedComponent, {});
  };
}
