import { variable, type Variable } from "modality-ts/core";
import type { TransitionRef } from "modality-ts/properties";

export const api_todos = {
  // state
  data: variable("swr:api_todos:data") as Variable<{ readonly kind: "option"; readonly inner: { readonly kind: "enum"; readonly values: readonly ["empty", "some"] } }, "swr:api_todos:data">,
  error: variable("swr:api_todos:error") as Variable<{ readonly kind: "bool" }, "swr:api_todos:error">,
  isValidating: variable("swr:api_todos:isValidating") as Variable<{ readonly kind: "bool" }, "swr:api_todos:isValidating">,

  // transitions
  fetch: "swr:api_todos:fetch" as TransitionRef<"swr:api_todos:fetch">,
  resolve: {
    error: "swr:api_todos:resolve:error" as TransitionRef<"swr:api_todos:resolve:error">,
    success: {
      "0": "swr:api_todos:resolve:success:0" as TransitionRef<"swr:api_todos:resolve:success:0">,
      "1": "swr:api_todos:resolve:success:1" as TransitionRef<"swr:api_todos:resolve:success:1">,
    },
  },
};

export const App = {
  // state
  draft: variable("local:App.draft") as Variable<{ readonly kind: "enum"; readonly values: readonly ["empty", "nonEmpty"] }, "local:App.draft">,
  saveStatus: variable("local:App.saveStatus") as Variable<{ readonly kind: "enum"; readonly values: readonly ["failed", "idle", "posting"] }, "local:App.saveStatus">,

  // transitions
  onChange: {
    draft: {
      empty: "App.onChange.draft.empty" as TransitionRef<"App.onChange.draft.empty">,
      nonEmpty: "App.onChange.draft.nonEmpty" as TransitionRef<"App.onChange.draft.nonEmpty">,
    },
  },
  onClick: {
    Add: "App.onClick.Add" as TransitionRef<"App.onClick.Add">,
    Login: "App.onClick.Login" as TransitionRef<"App.onClick.Login">,
    Logout: "App.onClick.Logout" as TransitionRef<"App.onClick.Logout">,
  },
};

export const authAtom: Variable<{ readonly kind: "enum"; readonly values: readonly ["guest", "user"] }, "atom:authAtom"> = variable("atom:authAtom");
