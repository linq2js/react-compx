import {
  Suspense,
  memo,
  useMemo,
  useState,
  useCallback,
  useEffect,
  lazy,
  createElement
} from "react";

let currentState = {};
let scopes = 0;
let stateChanged = false;
const hookTypes = {
  fetcher: 1
};
const defaultSelector = state => state;
const subscriptions = new Set();

function main(comp) {
  return memo(props => {
    const memoizedComp = useCallback(comp, []);
    const [, forceRerender] = useState();
    const context = useMemo(() => new Context(), []);
    context.__resetHook();
    context.__forceRerender = forceRerender;
    context.__cleanup();
    context.__throwErrorIfAny();
    useEffect(
      () => () => {
        context.__unmount();
      },
      [context]
    );
    try {
      return memoizedComp(props, context);
    } catch (ex) {
      if (ex instanceof AsyncError && ex.type === hookTypes.fetcher) {
        ex.target.subscribe(() => forceRerender({}));
        return context.__renderFallback() || null;
      }
    } finally {
      context.__tryToSubscribe();
    }
  });
}

class AsyncError {
  constructor(target, type) {
    this.target = target;
    this.type = type;
  }
}

class Context {
  __selectors = [];
  __prevValues = [];
  __forceRerender = undefined;
  __hooks = [];
  __hookIndex = 0;

  __throwErrorIfAny() {
    if (this.__lastError) {
      const error = this.__lastError;
      delete this.__lastError;
      throw error;
    }
  }
  __cleanup() {
    this.__selectors.length = 0;
    this.__prevValues.length = 0;
  }

  __tryToSubscribe() {
    if (!this.__selectors.length) {
      if (this.__unsubscribe) {
        this.__unsubscribe();
        this.__unsubscribe = undefined;
      }
      return;
    }

    this.__unsubscribe = subscribe(this.__checkForUpdate);
  }

  __unmount = () => {
    this.__isUnmount = true;
    this.__unsubscribe && this.__unsubscribe();
  };

  __resetHook() {
    if (this.__hookIndex !== this.__hooks.length) {
      throw new Error("Invalid number of hook");
    }
    this.__hookIndex = 0;
  }

  __getHook(type, factory) {
    let data = this.__hooks[this.__hookIndex];
    try {
      if (data && data.type !== type) {
        throw new Error(`Invalid hook. Expect ${type} but got ${data.type}`);
      }
      if (!data) {
        data = this.__hooks[this.__hookIndex] = factory();
        data.type = type;
      }
    } finally {
      this.__hookIndex++;
    }
    return data;
  }

  __checkForUpdate = () => {
    if (this.__isUnmount) return;
    try {
      const currentValues = this.__selectors.map(selector =>
        selector(currentState)
      );
      const hasChange =
        this.__prevValues.length !== currentValues.length ||
        this.__prevValues.some(
          (value, index) => value !== currentValues[index]
        );

      if (hasChange && this.__forceRerender) {
        this.__forceRerender({});
      }
    } catch (ex) {
      this.__lastError = ex;
    }
  };

  __renderFallback = () =>
    typeof this.__fallback === "function"
      ? createElement(this.__fallback)
      : this.__fallback;

  fallback = fallback => (this.__fallback = fallback);

  async = Object.assign(
    (fetcher, ...args) => {
      const hook = this.__getHook(hookTypes.fetcher, () => ({
        subscribe(subscription) {
          this.subscription = subscription;
        }
      }));

      if (
        hook.fetcher !== fetcher ||
        hook.args.some((value, index) => value !== args[index])
      ) {
        hook.token = {};
        hook.fetcher = fetcher;
        hook.args = args;
        hook.done = false;
        hook.loading = false;
        delete hook.payload;
        delete hook.error;
      }

      if (!hook.done) {
        if (!hook.loading) {
          hook.loading = true;
          const token = hook.token;
          fetcher(...hook.args).then(
            payload => {
              if (token !== hook.token || this.__isUnmount) return;
              hook.payload = payload;
              this.__asyncHookDone(hook);
              return payload;
            },
            error => {
              if (token !== hook.token || this.__isUnmount) return;
              hook.error = error;
              this.__asyncHookDone(hook);
            }
          );
        }
        throw new AsyncError(hook, hookTypes.fetcher);
      }

      if (hook.error) {
        throw hook.error;
      }

      return hook.payload;
    },
    {
      all: (...fetchers) => {
        const result = [];
        let lastError;
        try {
          for (const fetcher of fetchers) {
            result.push(this.async(...fetcher));
          }
        } catch (ex) {
          if (ex instanceof AsyncError && ex.type === hookTypes.fetcher) {
            lastError = ex;
          } else {
            throw ex;
          }
        }

        if (lastError) {
          throw lastError;
        }

        return result;
      }
    }
  );

  __asyncHookDone(hook) {
    hook.done = true;
    hook.loading = false;
    const everythingDone = this.__hooks
      .filter(x => x.type === hookTypes.fetcher)
      .every(x => x.done);
    if (!everythingDone) return;
    hook.subscription && hook.subscription();
  }

  dispatch = (action, ...args) => {
    return dispatch(action, ...args);
  };

  store = (selector = defaultSelector, defaultValue) => {
    if (typeof selector !== "function") {
      return dispatch(() => ({
        ...selector,
        $merge: true
      }));
    }
    this.__selectors.push(selector);
    const value = selector(currentState);
    this.__prevValues.push(value);
    return typeof value === "undefined" ? defaultValue : value;
  };

  update = state => {
    const hasChange = Object.keys(state).some(key => {
      if (state[key] !== this[key]) {
        this[key] = state[key];
        return true;
      }
      return false;
    });

    if (hasChange) {
      this.__forceRerender({});
    }

    return this;
  };

  get = this.store;
  call = this.dispatch;
  state = this;
}

function createLazy(...args) {
  const fallback = typeof args[0] === "function" ? "" : args.shift();
  return args.map(comp => {
    const LazyComponent = lazy(comp);
    return memo(props =>
      createElement(Suspense, { fallback }, createElement(LazyComponent, props))
    );
  });
}

function subscribe(callback) {
  subscriptions.add(callback);
  return () => subscriptions.delete(callback);
}

function getState() {
  return currentState;
}

function init(state) {
  if (state.then) {
    return state.then(payload => init(payload.default || payload));
  }
  let nextState = currentState;
  Object.keys(state).forEach(key => {
    if (key in currentState) return;
    if (nextState === currentState) {
      nextState = { ...currentState };
    }
    nextState[key] = state[key];
  });

  if (nextState !== currentState) {
    currentState = nextState;
    notify();
  }
}

function notify() {
  for (const subscription of subscriptions) {
    subscription();
  }
}

function extend(...prototypes) {
  Object.assign(Context.prototype, ...prototypes);
}

function dispatch(action, ...args) {
  if (action.__resolvedAction) {
    return dispatch(action.__resolvedAction, ...args);
  }

  if (action.then) {
    return action.then(payload =>
      dispatch(payload.default || payload, ...args)
    );
  }
  scopes++;
  try {
    const result = action(currentState, ...args);

    if (typeof result === "function") {
      return result(dispatch, getState);
    } else if (result && result.then) {
      return result.then(payload => {
        if (payload && typeof payload.default === "function") {
          action.__resolvedAction = payload.default;
          return dispatch(payload.default, ...args);
        }
        return payload;
      });
    }
    // reducer
    if (result && currentState !== result) {
      if (result && result.$merge === true) {
        const { $merge, ...otherValues } = result;
        let nextState = currentState;
        Object.keys(otherValues).forEach(key => {
          if (result[key] !== nextState[key]) {
            if (nextState === currentState) {
              nextState = { ...currentState };
            }
            nextState[key] = result[key];
            stateChanged = true;
          }
        });
        currentState = nextState;
      } else {
        stateChanged = true;
        currentState = result;
      }
    }
  } finally {
    scopes--;
    if (!scopes) {
      if (stateChanged) {
        stateChanged = false;
        notify();
      }
    }
  }
}

Object.assign(main, {
  init,
  dispatch,
  getState,
  subscribe,
  lazy: createLazy,
  extend
});

export default main;
