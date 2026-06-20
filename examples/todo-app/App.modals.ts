import { variable, type Variable } from "modality-ts/core";
import type { TransitionRef } from "modality-ts/properties";

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
    api: {
      createTodo: {
        start: "App.onClick.api.createTodo.start" as TransitionRef<"App.onClick.api.createTodo.start">,
        success: "App.onClick.api.createTodo.success" as TransitionRef<"App.onClick.api.createTodo.success">,
      },
    },
    Login: "App.onClick.Login" as TransitionRef<"App.onClick.Login">,
    Logout: "App.onClick.Logout" as TransitionRef<"App.onClick.Logout">,
  },
};

export const swr_api_todos_fetch = {
  // transitions
  _: {
    _: "swr:api_todos:fetch" as TransitionRef<"swr:api_todos:fetch">,
  },
};

export const swr_api_todos_resolve_error = {
  // transitions
  _: {
    _: "swr:api_todos:resolve:error" as TransitionRef<"swr:api_todos:resolve:error">,
  },
};

export const swr_api_todos_resolve_success_0 = {
  // transitions
  _: {
    _: "swr:api_todos:resolve:success:0" as TransitionRef<"swr:api_todos:resolve:success:0">,
  },
};

export const swr_api_todos_resolve_success_1 = {
  // transitions
  _: {
    _: "swr:api_todos:resolve:success:1" as TransitionRef<"swr:api_todos:resolve:success:1">,
  },
};
