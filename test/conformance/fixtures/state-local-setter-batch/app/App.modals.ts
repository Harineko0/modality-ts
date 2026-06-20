import { variable, type Variable } from "modality-ts/core";
import type { TransitionRef } from "modality-ts/properties";

// state
export const count: Variable<{ readonly kind: "boundedInt"; readonly min: 0; readonly max: 12 }, "local:App.count"> = variable("local:App.count") as Variable<{ readonly kind: "boundedInt"; readonly min: 0; readonly max: 12 }, "local:App.count">;

// transitions
export const App = {
  onClick: {
    count: {
      seq: {
        "1r9oku": "App.onClick.count.seq.1r9oku" as TransitionRef<"App.onClick.count.seq.1r9oku">,
        c0wzyx: "App.onClick.count.seq.c0wzyx" as TransitionRef<"App.onClick.count.seq.c0wzyx">,
      },
    },
  },
};
