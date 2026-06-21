import { variable, type Variable } from "modality-ts/core";
import type { TransitionRef } from "modality-ts/properties";

export const useDashboardSummary = {
  // state
  data: variable("swr:useDashboardSummary:data") as Variable<
    {
      readonly kind: "option";
      readonly inner: { readonly kind: "tokens"; readonly count: 1 };
    },
    "swr:useDashboardSummary:data"
  >,
  error: variable("swr:useDashboardSummary:error") as Variable<
    { readonly kind: "bool" },
    "swr:useDashboardSummary:error"
  >,
  isValidating: variable("swr:useDashboardSummary:isValidating") as Variable<
    { readonly kind: "bool" },
    "swr:useDashboardSummary:isValidating"
  >,

  // transitions
  fetch:
    "swr:useDashboardSummary:fetch" as TransitionRef<"swr:useDashboardSummary:fetch">,
  resolve: {
    error:
      "swr:useDashboardSummary:resolve:error" as TransitionRef<"swr:useDashboardSummary:resolve:error">,
    success: {
      "0": "swr:useDashboardSummary:resolve:success:0" as TransitionRef<"swr:useDashboardSummary:resolve:success:0">,
    },
  },
};
