import { variable, type Variable } from "modality-ts/core";
import type { TransitionRef } from "modality-ts/properties";

// state
export const orderStatus: Variable<{ readonly kind: "enum"; readonly values: readonly ["done", "idle", "submitting"] }, "local:App.orderStatus"> = variable("local:App.orderStatus") as Variable<{ readonly kind: "enum"; readonly values: readonly ["done", "idle", "submitting"] }, "local:App.orderStatus">;

// transitions
export const App = {
  onClick: {
    api: {
      placeOrder: {
        start: "App.onClick.api.placeOrder.start" as TransitionRef<"App.onClick.api.placeOrder.start">,
        success: "App.onClick.api.placeOrder.success" as TransitionRef<"App.onClick.api.placeOrder.success">,
      },
    },
    authAtom: {
      "1bllkl": "App.onClick.authAtom.1bllkl" as TransitionRef<"App.onClick.authAtom.1bllkl">,
      h4jaed: "App.onClick.authAtom.h4jaed" as TransitionRef<"App.onClick.authAtom.h4jaed">,
    },
    navigate: {
      _admin: "App.onClick.navigate._admin" as TransitionRef<"App.onClick.navigate._admin">,
    },
  },
};
export const swr_api_user_fetch = {
  _: {
    _: "swr:api_user:fetch" as TransitionRef<"swr:api_user:fetch">,
  },
};
export const swr_api_user_resolve_error = {
  _: {
    _: "swr:api_user:resolve:error" as TransitionRef<"swr:api_user:resolve:error">,
  },
};
export const swr_api_user_resolve_success_0 = {
  _: {
    _: "swr:api_user:resolve:success:0" as TransitionRef<"swr:api_user:resolve:success:0">,
  },
};
export const swr_api_user_resolve_success_1 = {
  _: {
    _: "swr:api_user:resolve:success:1" as TransitionRef<"swr:api_user:resolve:success:1">,
  },
};
