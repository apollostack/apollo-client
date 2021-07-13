import * as React from 'react';
import { invariant } from 'ts-invariant';
import { OperationVariables } from '../../core';
import { IDocumentDefinition } from '../parser';

export const defaultMapPropsToOptions = () => ({});
export const defaultMapResultToProps: <P>(props: P) => P = props => props;
export const defaultMapPropsToSkip = () => false;

export function getDisplayName<P>(WrappedComponent: React.ComponentType<P>) {
  return WrappedComponent.displayName || WrappedComponent.name || 'Component';
}

export function calculateVariablesFromProps<TProps>(
  operation: IDocumentDefinition,
  props: TProps
) {
  let variables: OperationVariables = {};
  for (let { variable, type } of operation.variables) {
    if (!variable.name || !variable.name.value) continue;

    const variableName = variable.name.value;
    const variableProp = (props as any)[variableName];

    if (typeof variableProp !== 'undefined') {
      variables[variableName] = variableProp;
      continue;
    }

    // Allow optional props
    if (type.kind !== 'NonNullType') {
      variables[variableName] = undefined;
    }
  }
  return variables;
}

export type RefSetter<TChildProps> = (
  ref: React.ComponentClass<TChildProps>
) => void | void;

// base class for hocs to easily manage refs
export class GraphQLBase<
  TProps,
  TChildProps,
  TState = any
> extends React.Component<TProps, TState> {
  public withRef: boolean = false;
  // wrapped instance
  private wrappedInstance?: React.ComponentClass<TChildProps>;

  constructor(props: TProps) {
    super(props);
    this.setWrappedInstance = this.setWrappedInstance.bind(this);
  }

  getWrappedInstance() {
    invariant(
      this.withRef,
      `To access the wrapped instance, you need to specify ` +
        `{ withRef: true } in the options`
    );

    return this.wrappedInstance;
  }

  setWrappedInstance(ref: React.ComponentClass<TChildProps>) {
    this.wrappedInstance = ref;
  }
}
