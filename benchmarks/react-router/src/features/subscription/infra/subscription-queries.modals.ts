import { variable, type Variable } from "modality-ts/core";
import type { TransitionRef } from "modality-ts/properties";

export const useApprovals = {
  // state
  data: variable("swr:useApprovals:data") as Variable<{ readonly kind: "option"; readonly inner: { readonly kind: "tokens"; readonly count: 1 } }, "swr:useApprovals:data">,
  error: variable("swr:useApprovals:error") as Variable<{ readonly kind: "bool" }, "swr:useApprovals:error">,
  isValidating: variable("swr:useApprovals:isValidating") as Variable<{ readonly kind: "bool" }, "swr:useApprovals:isValidating">,

  // transitions
  fetch: "swr:useApprovals:fetch" as TransitionRef<"swr:useApprovals:fetch">,
  resolve: {
    error: "swr:useApprovals:resolve:error" as TransitionRef<"swr:useApprovals:resolve:error">,
    success: {
      "0": "swr:useApprovals:resolve:success:0" as TransitionRef<"swr:useApprovals:resolve:success:0">,
    },
  },
};

export const useSubscription = {
  // state
  data: variable("swr:useSubscription:data") as Variable<{ readonly kind: "option"; readonly inner: { readonly kind: "tokens"; readonly count: 1 } }, "swr:useSubscription:data">,
  error: variable("swr:useSubscription:error") as Variable<{ readonly kind: "bool" }, "swr:useSubscription:error">,
  isValidating: variable("swr:useSubscription:isValidating") as Variable<{ readonly kind: "bool" }, "swr:useSubscription:isValidating">,

  // transitions
  fetch: "swr:useSubscription:fetch" as TransitionRef<"swr:useSubscription:fetch">,
  resolve: {
    error: "swr:useSubscription:resolve:error" as TransitionRef<"swr:useSubscription:resolve:error">,
    success: {
      "0": "swr:useSubscription:resolve:success:0" as TransitionRef<"swr:useSubscription:resolve:success:0">,
    },
  },
};
