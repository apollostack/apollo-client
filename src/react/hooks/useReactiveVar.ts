import { useState, useEffect } from 'react';
import { ReactiveVar } from '../../core';

export function useReactiveVar<T>(rv: ReactiveVar<T>): T {
  const value = rv();
  // We don't actually care what useState thinks the value of the variable
  // is, so we take only the update function from the returned array.
  const [, setValue] = useState(value);
  // We subscribe to variable updates on initial mount and when the value has
  // changed. This avoids a subtle bug in React.StrictMode where multiple listeners
  // are added, leading to inconsistent updates.
  useEffect(() => rv.onNextChange(setValue), [value]);
  // Once the component is unmounted, ignore future updates. Note that the
  // above useEffect function returns a mute function without calling it,
  // allowing it to be called when the component unmounts. This is
  // equivalent to the following, but shorter:
  // useEffect(() => {
  //   const mute = rv.onNextChange(setValue);
  //   return () => mute();
  // }, [value])
  return value;
}
