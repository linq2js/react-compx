import compx from "react-compx";

const callApi = (resolvedData, time = 100) =>
  new Promise(resolve => setTimeout(resolve, time, resolvedData));

afterEach(compx.cleanup);

test("Should update state async", async () => {
  const LoadData = () => ({
    $async: true,
    prop1: callApi(1, 100),
    prop2: callApi(2, 200)
  });

  await compx.dispatch(LoadData);

  expect(compx.getState()).toEqual({
    prop1: 1,
    prop2: 2
  });
});
