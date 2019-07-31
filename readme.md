# react-compx

## Count App (using local state)

```jsx harmony
import React from "react";
import { render } from "react-dom";
import compx from "react-compx";

const App = compx((props, { count1 = 1, count2 = 2, update }) => {
  return (
    <>
      <h1>Count1: {count1}</h1>
      <button onClick={() => update({ count1: count1 + 1 })}>
        Increase Count1
      </button>
      <h1>Count2: {count2}</h1>
      <button onClick={() => update({ count2: count2 + 1 })}>
        Increase Count2
      </button>
    </>
  );
});
render(<App />, document.getElementById("root"));
```

react-compx brings legacy local state management to functional component, that helps you getting and updating state easier

```jsx harmony
const ComponentThatUsingHooks = () => {
  const [state1, setState1] = useState(defaultValue1);
  const [state2, setState2] = useState(defaultValue2);

  const handleChange = () => {
    setState1(value1);
    setState2(value2);
  };
};

const CompXComponent = compx(
  (props, { state1 = defaultValue1, state2 = defaultValue2 }) => {
    const handleChange = () => {
      update({
        state1: value1,
        state2: value2
      });
    };
  }
);
```

## List Swapping (using store)

```jsx harmony
import React from "react";
import { render } from "react-dom";
import compx from "react-compx";

// init store
compx.init({ count1: 1, count2: 2 });

// define actions
const IncreaseCount1 = (state, step = 1) => ({
  ...state,
  count1: state.count1 + step
});
const IncreaseCount2 = state => ({ ...state, count2: state.count2 + 1 });
const AutoMergeIncreaseCount1 = state => ({
  // when $merge = true, all props of returned object will be merged with current state
  $merge: true,
  count1: state.count1 + 1
});

const App = compx((props, { store, dispatch }) => {
  // extract state from store
  const count1 = store(state => state.count1);
  const count2 = store(state => state.count2);
  return (
    <>
      <h1>Count1: {count1}</h1>
      <button onClick={() => dispatch(IncreaseCount1)}>Increase Count1</button>
      <button onClick={() => dispatch(IncreaseCount1, 2)}>
        Increase Count1 by 2
      </button>
      <h1>Count2: {count2}</h1>
      <button onClick={() => dispatch(IncreaseCount2)}>Increase Count2</button>
    </>
  );
});
render(<App />, document.getElementById("root"));
```

## Dispatching other action

```jsx harmony
import compx from "react-compx";

compx.init({ userToken: "", productFilter: "" });

// nothing to process if action return a promise
const CallApi = async ({ userToken }, url, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: userToken
    },
    body: JSON.stringify(body)
  });

  return await res.json();
};

const LoadProductSuccess = (state, payload) => {
  console.log(payload);
  return {
    $merge: true,
    productList: payload
  };
};

// if action return a function, that function will receive dispatch method as first argument
// beside, the second argument of that function is state getter
const LoadProduct = ({ productFilter }, page, size) => {
  return async (dispatch, getState) => {
    // get current state
    console.log(getState());
    const payload = await dispatch(
      CallApi,
      "//www.mocky.io/v2/5d40c2b83100006b00539002",
      {
        filter: productFilter,
        page,
        size
      }
    );

    dispatch(LoadProductSuccess, payload);
  };
};

compx.dispatch(LoadProduct, 0, 10);
```

## Using async loader inside component

```jsx harmony
import React from "react";
import { render } from "react-dom";
import compx from "react-compx";

const ProductListLoader = (page, size) =>
  fetch("//www.mocky.io/v2/5d40c2b83100006b00539002?mocky-delay=1s", {
    method: "POST",
    body: JSON.stringify({
      page,
      size
    })
  }).then(res => res.json());

const App = compx((props, { async, fallback }) => {
  // render fallback when async loader is busy
  fallback(() => "Loading...");
  const page = 0;
  const size = 10;
  // calling loader and passing arguments to loader
  const productList = async(ProductListLoader, page, size);

  return (
    <ul>
      {productList.map(product => (
        <li>{product["product-name"]}</li>
      ))}
    </ul>
  );
});

render(<App />, document.getElementById("root"));
```

By default, async() function processes loaders one by one,
call async.all(\[...loaders]) if you want to call multiple loaders at once

```jsx harmony
const App = compx((props, { async }) => {
  const [result1, result2] = async.all(
    [Loader1, loader1Param1, loader1Param2],
    [Loader2, loader2Param1, loader2Param2]
  );

  console.log(result1, result2);
});
```

No async.race supported because all loaders must be fulfilled before rendering start

### Rules of async loader

Because async() and async.all() are hooks so react hook rules apply for them as well.
[Please refer this link for further info](https://reactjs.org/docs/hooks-rules.html)
