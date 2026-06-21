import { variable, type Variable } from "modality-ts/core";
import type { TransitionRef } from "modality-ts/properties";

export const api_user = {
  // state
  data: variable("swr:api_user:data") as Variable<{ readonly kind: "option"; readonly inner: { readonly kind: "enum"; readonly values: readonly ["alice", "bob"] } }, "swr:api_user:data">,
  error: variable("swr:api_user:error") as Variable<{ readonly kind: "bool" }, "swr:api_user:error">,
  isValidating: variable("swr:api_user:isValidating") as Variable<{ readonly kind: "bool" }, "swr:api_user:isValidating">,

  // transitions
  fetch: "swr:api_user:fetch" as TransitionRef<"swr:api_user:fetch">,
  resolve: {
    error: "swr:api_user:resolve:error" as TransitionRef<"swr:api_user:resolve:error">,
    success: {
      "0": "swr:api_user:resolve:success:0" as TransitionRef<"swr:api_user:resolve:success:0">,
      "1": "swr:api_user:resolve:success:1" as TransitionRef<"swr:api_user:resolve:success:1">,
    },
  },
};

export const App = {
  // state
  orderStatus: variable("local:App.orderStatus") as Variable<{ readonly kind: "enum"; readonly values: readonly ["done", "idle", "submitting"] }, "local:App.orderStatus">,

  // transitions
  onClick: {
    Login: "App.onClick.Login" as TransitionRef<"App.onClick.Login">,
    Logout: "App.onClick.Logout" as TransitionRef<"App.onClick.Logout">,
    navigate: {
      _admin: "App.onClick.navigate._admin" as TransitionRef<"App.onClick.navigate._admin">,
    },
    "Place order": "App.onClick.Place order" as TransitionRef<"App.onClick.Place order">,
  },
};

export const authAtom: Variable<{ readonly kind: "enum"; readonly values: readonly ["guest", "user"] }, "atom:authAtom"> = variable("atom:authAtom");
