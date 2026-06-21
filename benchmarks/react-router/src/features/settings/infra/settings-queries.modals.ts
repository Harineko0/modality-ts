import { variable, type Variable } from "modality-ts/core";
import type { TransitionRef } from "modality-ts/properties";

export const useRoleAssignments = {
  // state
  data: variable("swr:useRoleAssignments:data") as Variable<{ readonly kind: "option"; readonly inner: { readonly kind: "tokens"; readonly count: 1 } }, "swr:useRoleAssignments:data">,
  error: variable("swr:useRoleAssignments:error") as Variable<{ readonly kind: "bool" }, "swr:useRoleAssignments:error">,
  isValidating: variable("swr:useRoleAssignments:isValidating") as Variable<{ readonly kind: "bool" }, "swr:useRoleAssignments:isValidating">,

  // transitions
  fetch: "swr:useRoleAssignments:fetch" as TransitionRef<"swr:useRoleAssignments:fetch">,
  resolve: {
    error: "swr:useRoleAssignments:resolve:error" as TransitionRef<"swr:useRoleAssignments:resolve:error">,
    success: {
      "0": "swr:useRoleAssignments:resolve:success:0" as TransitionRef<"swr:useRoleAssignments:resolve:success:0">,
    },
  },
};

export const useSettings = {
  // state
  data: variable("swr:useSettings:data") as Variable<{ readonly kind: "option"; readonly inner: { readonly kind: "tokens"; readonly count: 1 } }, "swr:useSettings:data">,
  error: variable("swr:useSettings:error") as Variable<{ readonly kind: "bool" }, "swr:useSettings:error">,
  isValidating: variable("swr:useSettings:isValidating") as Variable<{ readonly kind: "bool" }, "swr:useSettings:isValidating">,

  // transitions
  fetch: "swr:useSettings:fetch" as TransitionRef<"swr:useSettings:fetch">,
  resolve: {
    error: "swr:useSettings:resolve:error" as TransitionRef<"swr:useSettings:resolve:error">,
    success: {
      "0": "swr:useSettings:resolve:success:0" as TransitionRef<"swr:useSettings:resolve:success:0">,
    },
  },
};
