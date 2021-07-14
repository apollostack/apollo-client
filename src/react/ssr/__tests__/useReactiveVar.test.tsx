/** @jest-environment node */
import React from 'react';
import { makeVar } from '../../../core';
import { useReactiveVar } from '../../hooks';
import { itAsync } from "../../../testing";
import { renderToStringWithData } from '../';

describe('useReactiveVar Hook SSR', () => {
  itAsync("does not cause warnings", (resolve, reject) => {
    const mock = jest.spyOn(console, 'error');
    const counterVar = makeVar(0);
    function Component() {
      const count = useReactiveVar(counterVar);
      counterVar(1);
      counterVar(2);
      return <div>{count}</div>;
    }

    renderToStringWithData(<Component />).then((value) => {
      expect(value).toEqual('<div>0</div>');
      expect(mock).toHaveBeenCalledTimes(0);
    }).finally(() => {
      mock.mockRestore();
    }).then(resolve, reject);
  });
});
