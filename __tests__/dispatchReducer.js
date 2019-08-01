import compx from "react-compx";

afterEach(() => compx.cleanup(true));

test("Should update specified prop automatically", () => {
  compx.init({ power: 2 });
  const Compute = (state, value1, value2) =>
    Math.pow(value1, state.power) + value2;
  compx.dispatch(["test", Compute, 2], 3);

  expect(compx.getState()).toEqual({
    power: 2,
    test: Math.pow(2, 2) + 3
  });
});
