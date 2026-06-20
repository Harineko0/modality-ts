import { variable, type Variable } from "modality-ts/core";
import type { TransitionRef } from "modality-ts/properties";

// state
export const draft: Variable<{ readonly kind: "enum"; readonly values: readonly ["empty", "nonEmpty"] }, "local:App.draft"> = variable("local:App.draft") as Variable<{ readonly kind: "enum"; readonly values: readonly ["empty", "nonEmpty"] }, "local:App.draft">;
export const saveStatus: Variable<{ readonly kind: "enum"; readonly values: readonly ["failed", "idle", "posting"] }, "local:App.saveStatus"> = variable("local:App.saveStatus") as Variable<{ readonly kind: "enum"; readonly values: readonly ["failed", "idle", "posting"] }, "local:App.saveStatus">;

// transitions
export const app_add: TransitionRef<"App.onClick.api.createTodo.start"> = "App.onClick.api.createTodo.start" as TransitionRef<"App.onClick.api.createTodo.start">;
export const app_draft: TransitionRef<"App.onChange.draft.empty"> = "App.onChange.draft.empty" as TransitionRef<"App.onChange.draft.empty">;
export const app_draft_2: TransitionRef<"App.onChange.draft.nonEmpty"> = "App.onChange.draft.nonEmpty" as TransitionRef<"App.onChange.draft.nonEmpty">;
export const app_draft_saveStatus: TransitionRef<"App.onClick.api.createTodo.success"> = "App.onClick.api.createTodo.success" as TransitionRef<"App.onClick.api.createTodo.success">;
export const app_login: TransitionRef<"App.onClick.authAtom"> = "App.onClick.authAtom" as TransitionRef<"App.onClick.authAtom">;
export const app_logout: TransitionRef<"App.onClick.authAtom_draft_saveStatus.seq"> = "App.onClick.authAtom_draft_saveStatus.seq" as TransitionRef<"App.onClick.authAtom_draft_saveStatus.seq">;
export const swr_api_todos_fetch_timer: TransitionRef<"swr:api_todos:fetch"> = "swr:api_todos:fetch" as TransitionRef<"swr:api_todos:fetch">;
export const swr_api_todos_resolve_error_resolve: TransitionRef<"swr:api_todos:resolve:error"> = "swr:api_todos:resolve:error" as TransitionRef<"swr:api_todos:resolve:error">;
export const swr_api_todos_resolve_success_0_resolve: TransitionRef<"swr:api_todos:resolve:success:0"> = "swr:api_todos:resolve:success:0" as TransitionRef<"swr:api_todos:resolve:success:0">;
export const swr_api_todos_resolve_success_1_resolve: TransitionRef<"swr:api_todos:resolve:success:1"> = "swr:api_todos:resolve:success:1" as TransitionRef<"swr:api_todos:resolve:success:1">;
