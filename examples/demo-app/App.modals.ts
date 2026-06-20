import { variable, type Variable } from "modality-ts/core";
import type { TransitionRef } from "modality-ts/properties";

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

export const swr_api_user_fetch = {
  // transitions
  _: {
    _: "swr:api_user:fetch" as TransitionRef<"swr:api_user:fetch">,
  },
};

export const swr_api_user_resolve_error = {
  // transitions
  _: {
    _: "swr:api_user:resolve:error" as TransitionRef<"swr:api_user:resolve:error">,
  },
};

export const swr_api_user_resolve_success_0 = {
  // transitions
  _: {
    _: "swr:api_user:resolve:success:0" as TransitionRef<"swr:api_user:resolve:success:0">,
  },
};

export const swr_api_user_resolve_success_1 = {
  // transitions
  _: {
    _: "swr:api_user:resolve:success:1" as TransitionRef<"swr:api_user:resolve:success:1">,
  },
};
