import compx from "react-compx";

afterEach(compx.cleanup);

test("computed prop should work properly", () => {
  compx.init({ a: 1, b: 2 }).computed("sum", ({ a, b }) => a + b);

  expect(compx.getState().sum).toBe(3);

  compx.dispatch(() => ({ $merge: true, a: 10 }));

  expect(compx.getState().sum).toBe(12);
});
