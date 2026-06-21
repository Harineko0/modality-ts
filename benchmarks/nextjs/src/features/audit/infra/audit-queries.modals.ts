import { variable, type Variable } from "modality-ts/core";
import type { TransitionRef } from "modality-ts/properties";

export const useAuditEvents = {
  // state
  data: variable("swr:useAuditEvents:data") as Variable<{ readonly kind: "option"; readonly inner: { readonly kind: "tokens"; readonly count: 1 } }, "swr:useAuditEvents:data">,
  error: variable("swr:useAuditEvents:error") as Variable<{ readonly kind: "bool" }, "swr:useAuditEvents:error">,
  isValidating: variable("swr:useAuditEvents:isValidating") as Variable<{ readonly kind: "bool" }, "swr:useAuditEvents:isValidating">,

  // transitions
  fetch: "swr:useAuditEvents:fetch" as TransitionRef<"swr:useAuditEvents:fetch">,
  resolve: {
    error: "swr:useAuditEvents:resolve:error" as TransitionRef<"swr:useAuditEvents:resolve:error">,
    success: {
      "0": "swr:useAuditEvents:resolve:success:0" as TransitionRef<"swr:useAuditEvents:resolve:success:0">,
    },
  },
};
