import { type Variable, variable } from "modality-ts/core";
import type { TransitionRef } from "modality-ts/properties";

export const App = {
  // state
  count: variable("local:App.count") as Variable<
    { readonly kind: "boundedInt"; readonly min: 0; readonly max: 12 },
    "local:App.count"
  >,

  // transitions
  onClick: {
    "Direct batch":
      "App.onClick.Direct batch" as TransitionRef<"App.onClick.Direct batch">,
    "Functional batch":
      "App.onClick.Functional batch" as TransitionRef<"App.onClick.Functional batch">,
  },
};
