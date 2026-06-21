import { always } from "modality-ts/core/props";

export default [
  always(
    "counter value is modeled",
    (s) => s.read("redux:store.counter.value") !== undefined,
  ),
];
