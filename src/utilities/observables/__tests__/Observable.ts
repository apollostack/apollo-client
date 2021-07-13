import { Observable, Subscriber } from '../Observable';

describe('Observable', () => {
  describe('subclassing by non-class constructor functions', () => {
    function check(constructor: new <T>(sub: Subscriber<T>) => Observable<T>) {
      constructor.prototype = Object.create(Observable.prototype, {
        constructor: {
          value: constructor,
        },
      });

      const subscriber: Subscriber<number> = observer => {
        observer.next(123);
        observer.complete();
      };

      const obs = new constructor(subscriber) as Observable<number>;

      expect(typeof (obs as any).sub).toBe("function");
      expect((obs as any).sub).toBe(subscriber);

      expect(obs).toBeInstanceOf(Observable);
      expect(obs).toBeInstanceOf(constructor);
      expect(obs.constructor).toBe(constructor);

      return new Promise((resolve, reject) => {
        obs.subscribe({
          next: resolve,
          error: reject,
        });
      }).then(value => {
        expect(value).toBe(123);
      });
    }

    function newify(
      constructor: <T>(sub: Subscriber<T>) => void,
    ): new <T>(sub: Subscriber<T>) => Observable<T> {
      return constructor as any;
    }

    it('simulating super(sub) with Observable.call(this, sub)', () => {
      function SubclassWithSuperCall<T>(sub: Subscriber<T>) {
        const self = Observable.call(this, sub) || this;
        self.sub = sub;
        return self;
      }
      return check(newify(SubclassWithSuperCall));
    });

    it('simulating super(sub) with Observable.apply(this, arguments)', () => {
      function SubclassWithSuperApplyArgs<T>(_sub: Subscriber<T>) {
        const self = Observable.apply(this, arguments) || this;
        self.sub = _sub;
        return self;
      }
      return check(newify(SubclassWithSuperApplyArgs));
    });

    it('simulating super(sub) with Observable.apply(this, [sub])', () => {
      function SubclassWithSuperApplyArray<T>(...args: [Subscriber<T>]) {
        const self = Observable.apply(this, args) || this;
        self.sub = args[0];
        return self;
      }
      return check(newify(SubclassWithSuperApplyArray));
    });
  });
});
