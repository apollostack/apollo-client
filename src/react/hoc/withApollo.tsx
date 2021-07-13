import * as React from 'react';
import hoistNonReactStatics from 'hoist-non-react-statics';
import { invariant } from 'ts-invariant';

import { ApolloConsumer } from '../context';
import { OperationOption, WithApolloClient } from './types';

function getDisplayName<P>(WrappedComponent: React.ComponentType<P>) {
  return WrappedComponent.displayName || WrappedComponent.name || 'Component';
}

export function withApollo<TProps, TResult = any>(
  WrappedComponent: React.ComponentType<
    WithApolloClient<Omit<TProps, 'client'>>
  >,
  operationOptions: OperationOption<TProps, TResult> = {}
): React.ComponentClass<Omit<TProps, 'client'>> {
  const withDisplayName = `withApollo(${getDisplayName(WrappedComponent)})`;

  class WithApollo extends React.Component<Omit<TProps, 'client'>> {
    static displayName = withDisplayName;
    static WrappedComponent = WrappedComponent;

    // wrapped instance
    private wrappedInstance: any;

    constructor(props: Omit<TProps, 'client'>) {
      super(props);
      this.setWrappedInstance = this.setWrappedInstance.bind(this);
    }

    getWrappedInstance() {
      invariant(
        operationOptions.withRef,
        `To access the wrapped instance, you need to specify ` +
          `{ withRef: true } in the options`
      );

      return this.wrappedInstance;
    }

    setWrappedInstance(ref: React.ComponentType<WithApolloClient<TProps>>) {
      this.wrappedInstance = ref;
    }

    render() {
      return (
        <ApolloConsumer>
          {client => {
            const props = Object.assign({}, this.props, {
              client,
              ref: operationOptions.withRef
                ? this.setWrappedInstance
                : undefined
            });
            return <WrappedComponent {...props} />;
          }}
        </ApolloConsumer>
      );
    }
  }

  // Make sure we preserve any custom statics on the original component.
  return hoistNonReactStatics(WithApollo, WrappedComponent, {});
}
