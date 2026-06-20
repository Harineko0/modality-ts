import { always } from "modality-ts/core/props";

export default [
  always(
    "todos query is modeled",
    (s) => s.read("tanstack-query:todos:status") !== undefined,
  ),
];
