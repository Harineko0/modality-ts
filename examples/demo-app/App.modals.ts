import { variable, type Variable } from "modality-ts/core";
import type { TransitionRef } from "modality-ts/properties";

// state
export const orderStatus: Variable<{ readonly kind: "enum"; readonly values: readonly ["done", "idle", "submitting"] }, "local:App.orderStatus"> = variable("local:App.orderStatus") as Variable<{ readonly kind: "enum"; readonly values: readonly ["done", "idle", "submitting"] }, "local:App.orderStatus">;

// transitions
export const app_login: TransitionRef<"App.onClick.authAtom.h4jaed"> = "App.onClick.authAtom.h4jaed" as TransitionRef<"App.onClick.authAtom.h4jaed">;
export const app_logout: TransitionRef<"App.onClick.authAtom.1bllkl"> = "App.onClick.authAtom.1bllkl" as TransitionRef<"App.onClick.authAtom.1bllkl">;
export const app_navigate: TransitionRef<"App.onClick.navigate._admin"> = "App.onClick.navigate._admin" as TransitionRef<"App.onClick.navigate._admin">;
export const app_orderStatus: TransitionRef<"App.onClick.api.placeOrder.success"> = "App.onClick.api.placeOrder.success" as TransitionRef<"App.onClick.api.placeOrder.success">;
export const app_placeOrder: TransitionRef<"App.onClick.api.placeOrder.start"> = "App.onClick.api.placeOrder.start" as TransitionRef<"App.onClick.api.placeOrder.start">;
export const swr_api_user_fetch_timer: TransitionRef<"swr:api_user:fetch"> = "swr:api_user:fetch" as TransitionRef<"swr:api_user:fetch">;
export const swr_api_user_resolve_error_resolve: TransitionRef<"swr:api_user:resolve:error"> = "swr:api_user:resolve:error" as TransitionRef<"swr:api_user:resolve:error">;
export const swr_api_user_resolve_success_0_resolve: TransitionRef<"swr:api_user:resolve:success:0"> = "swr:api_user:resolve:success:0" as TransitionRef<"swr:api_user:resolve:success:0">;
export const swr_api_user_resolve_success_1_resolve: TransitionRef<"swr:api_user:resolve:success:1"> = "swr:api_user:resolve:success:1" as TransitionRef<"swr:api_user:resolve:success:1">;
