import { configureStore, createSlice } from "@reduxjs/toolkit";
import { Provider, useDispatch, useSelector } from "react-redux";

const counterSlice = createSlice({
  name: "counter",
  initialState: { value: 0 },
  reducers: {
    increment: (state) => {
      state.value += 1;
    },
  },
});

const store = configureStore({
  reducer: { counter: counterSlice.reducer },
});

const { increment } = counterSlice.actions;

export function App() {
  const value = useSelector(
    (state: { counter: { value: number } }) => state.counter.value,
  );
  const dispatch = useDispatch();
  return (
    <Provider store={store}>
      <button type="button" onClick={() => dispatch(increment())}>
        {value}
      </button>
    </Provider>
  );
}
