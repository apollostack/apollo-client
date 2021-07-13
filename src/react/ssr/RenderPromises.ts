import { DocumentNode } from 'graphql';

import { ObservableQuery } from '../../core';
import { QueryDataOptions } from '../types/types';
import { QueryData } from '../data/QueryData';

type QueryInfo = {
  seen: boolean;
  observable: ObservableQuery<any, any> | null;
};

function makeDefaultQueryInfo(): QueryInfo {
  return {
    seen: false,
    observable: null
  };
}

export class RenderPromises {
  // Map from Query component instances to pending fetchData promises.
  private queryPromises = new Map<QueryDataOptions<any, any>, Promise<any>>();

  // Two-layered map from (query document, stringified variables) to QueryInfo
  // objects. These QueryInfo objects are intended to survive through the whole
  // getMarkupFromTree process, whereas specific Query instances do not survive
  // beyond a single call to renderToStaticMarkup.
  private queryInfoTrie = new Map<DocumentNode, Map<string, QueryInfo>>();

  private stopped = false;
  public stop() {
    if (!this.stopped) {
      this.queryPromises.clear();
      this.queryInfoTrie.clear();
      this.stopped = true;
    }
  }

  // Registers the server side rendered observable.
  public registerSSRObservable<TData, TVariables>(
    observable: ObservableQuery<any, TVariables>,
    props: QueryDataOptions<TData, TVariables>
  ) {
    if (this.stopped) return;
    this.lookupQueryInfo(props).observable = observable;
  }

  // Get's the cached observable that matches the SSR Query instances query and variables.
  public getSSRObservable<TData, TVariables>(
    props: QueryDataOptions<TData, TVariables>
  ) {
    return this.lookupQueryInfo(props).observable;
  }

  public addQueryPromise<TData, TVariables>(
    queryInstance: QueryData<TData, TVariables>,
    finish: () => React.ReactNode
  ): React.ReactNode {
    if (!this.stopped) {
      const info = this.lookupQueryInfo(queryInstance.getOptions());
      if (!info.seen) {
        this.queryPromises.set(
          queryInstance.getOptions(),
          new Promise(resolve => {
            resolve(queryInstance.fetchData());
          })
        );
        // Render null to abandon this subtree for this rendering, so that we
        // can wait for the data to arrive.
        return null;
      }
    }
    return finish();
  }

  public hasPromises() {
    return this.queryPromises.size > 0;
  }

  public consumeAndAwaitPromises() {
    const promises: Promise<any>[] = [];
    this.queryPromises.forEach((promise, queryInstance) => {
      // Make sure we never try to call fetchData for this query document and
      // these variables again. Since the queryInstance objects change with
      // every rendering, deduplicating them by query and variables is the
      // best we can do. If a different Query component happens to have the
      // same query document and variables, it will be immediately rendered
      // by calling finish() in addQueryPromise, which could result in the
      // rendering of an unwanted loading state, but that's not nearly as bad
      // as getting stuck in an infinite rendering loop because we kept calling
      // queryInstance.fetchData for the same Query component indefinitely.
      this.lookupQueryInfo(queryInstance).seen = true;
      promises.push(promise);
    });
    this.queryPromises.clear();
    return Promise.all(promises);
  }

  private lookupQueryInfo<TData, TVariables>(
    props: QueryDataOptions<TData, TVariables>
  ): QueryInfo {
    const { queryInfoTrie } = this;
    const { query, variables } = props;
    const varMap = queryInfoTrie.get(query) || new Map<string, QueryInfo>();
    if (!queryInfoTrie.has(query)) queryInfoTrie.set(query, varMap);
    const variablesString = JSON.stringify(variables);
    const info = varMap.get(variablesString) || makeDefaultQueryInfo();
    if (!varMap.has(variablesString)) varMap.set(variablesString, info);
    return info;
  }
}
