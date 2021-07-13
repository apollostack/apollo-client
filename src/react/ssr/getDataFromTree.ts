import * as React from 'react';
import { getApolloContext } from '../context';
import { RenderPromises } from './RenderPromises';

export function getDataFromTree(
  tree: React.ReactNode,
  context: { [key: string]: any } = {}
) {
  return getMarkupFromTree({
    tree,
    context,
    // If you need to configure this renderFunction, call getMarkupFromTree
    // directly instead of getDataFromTree.
    renderFunction: require('react-dom/server').renderToStaticMarkup
  });
}

export type GetMarkupFromTreeOptions = {
  tree: React.ReactNode;
  context?: { [key: string]: any };
  renderFunction?: (
    tree: React.ReactElement<any>,
  ) => string | PromiseLike<string>;
};

export function getMarkupFromTree({
  tree,
  context = {},
  // The rendering function is configurable! We use renderToStaticMarkup as
  // the default, because it's a little less expensive than renderToString,
  // and legacy usage of getDataFromTree ignores the return value anyway.
  renderFunction = require('react-dom/server').renderToStaticMarkup
}: GetMarkupFromTreeOptions): Promise<string> {
  const renderPromises = new RenderPromises();

  function process(): Promise<string> {
    // Always re-render from the rootElement, even though it might seem
    // better to render the children of the component responsible for the
    // promise, because it is not possible to reconstruct the full context
    // of the original rendering (including all unknown context provider
    // elements) for a subtree of the original component tree.
    const ApolloContext = getApolloContext();

    return new Promise<string>(resolve => {
      const element = React.createElement(
        ApolloContext.Provider,
        { value: { ...context, renderPromises }},
        tree,
      );
      resolve(renderFunction(element));
    }).then(html => {
      return renderPromises.hasPromises()
        ? renderPromises.consumeAndAwaitPromises().then(process)
        : html;
    }).finally(() => {
      renderPromises.stop();
    });
  }

  return Promise.resolve().then(process);
}
