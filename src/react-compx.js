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
let computedProps = {};
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
  setState(nextState);
  return main;
}

function notify() {
  for (const subscription of subscriptions) {
    subscription(currentState);
  }
}

function extend(...prototypes) {
  Object.assign(Context.prototype, ...prototypes);
  return main;
}

function dispatch(action, ...args) {
  if (action.__resolvedAction) {
    return dispatch(action.__resolvedAction, ...args);
  }

  if (Array.isArray(action)) {
    return dispatchReducer(action, args);
  }

  if (action.then) {
    return action.then(payload =>
      dispatch(payload.default || payload, ...args)
    );
  }
  scopes++;
  try {
    let result = action(currentState, ...args);

    if (typeof result === "function") {
      return result(dispatch, getState);
    }
    // process async result
    else if (result && result.then) {
      return result.then(payload => {
        // async result can be action
        if (payload && typeof payload.default === "function") {
          action.__resolvedAction = payload.default;
          return dispatch(payload.default, ...args);
        }
        return payload;
      });
    }
    // check is there any async prop
    const asyncProps = [];
    const normalProps = [];
    Object.entries(result).forEach(([key, value]) =>
      key === "$failure" || (value && value.then)
        ? asyncProps.push([key, value])
        : normalProps.push([key, value])
    );

    if (asyncProps.length) {
      if (normalProps.length) {
        const reducedNormalProps = normalProps.reduce((props, [key, value]) => {
          props[key] = value;
          return props;
        }, {});

        setState(reducedNormalProps);
      }

      const reducedAsyncProps = asyncProps.reduce((props, [key, value]) => {
        props[key] = value;
        return props;
      }, {});

      return dispatchAsync(reducedAsyncProps);
    }

    setState(result);

    // reducer
  } finally {
    scopes--;
    if (!scopes) {
      if (stateChanged) {
        currentState = recompute(currentState);
        stateChanged = false;
        notify();
      }
    }
  }
}

function dispatchReducer(action, appendArgs) {
  const [prop, ...prependArgs] = action;
  const multipleProps = typeof prop !== "string";
  const entries = multipleProps
    ? Object.entries(prop)
    : [[prop, prependArgs.shift()]];
  const args = [...prependArgs, ...appendArgs];

  return dispatch(state => {
    return entries.reduce(
      (result, [key, factory]) => {
        result[key] = factory(state, ...args);
        return result;
      },
      {
        $merge: true
      }
    );
  });
}

function recompute() {
  let nextState = currentState;
  Object.entries(computedProps).forEach(([key, computer]) => {
    const nextValue = computer(nextState);
    if (nextValue !== nextState[key]) {
      if (nextState === currentState) {
        nextState = { ...currentState };
      }
      nextState[key] = nextValue;
    }
  });
  return nextState;
}

function computed(...args) {
  if (args.length > 1) {
    return computed({
      [args[0]]: args[1]
    });
  }
  Object.assign(computedProps, args[0]);
  setState(recompute());

  return main;
}

function setState(nextState) {
  if (nextState && currentState !== nextState) {
    // process merging
    if (nextState.$merge === true) {
      const { $merge, ...otherValues } = nextState;
      const prevState = currentState;
      Object.keys(otherValues).forEach(key => {
        const currentValue = otherValues[key];
        if (currentState[key] !== currentValue) {
          if (currentState === prevState) {
            currentState = { ...currentState };
          }
          currentState[key] = currentValue;
          stateChanged = true;
        }
      });
    } else {
      stateChanged = true;
      currentState = nextState;
    }
  }

  if (stateChanged) {
    if (!scopes) {
      stateChanged = false;
      notify();
    }
  }

  return main;
}

function createBindings(selectors) {
  Object.entries(selectors).forEach(([key, selector]) => {
    if (selector === true) {
      selector = state => state[key];
    } else if (typeof selector !== "function") {
      const prop = selector;
      selector = state => state[prop];
    }
    delete Context.prototype["$" + key];
    Object.defineProperty(Context.prototype, "$" + key, {
      configurable: true,
      get() {
        const value = selector(currentState);
        this.__prevValues.push(value);
        this.__selectors.push(selector);
        return value;
      }
    });
  });

  return main;
}

async function dispatchAsync({ $failure, ...props }) {
  const entries = Object.entries(props);
  const promises = entries.map(async ([key, promise]) => {
    try {
      const payload = await promise;
      dispatch(() => ({
        $merge: true,
        [key]: payload
      }));
    } catch (e) {
      $failure && dispatch($failure, e);
    }
  });

  return Promise.all(promises);
}

function cleanup(...args) {
  currentState = {};
  subscriptions.clear();
  if (args[0]) {
    computedProps = {};
  }

  return main;
}

Object.assign(main, {
  init,
  dispatch,
  getState,
  subscribe,
  lazy: createLazy,
  extend,
  cleanup,
  computed,
  bind: createBindings
});

export default main;
