import { type Variable, variable } from "modality-ts/core";
import type { TransitionRef } from "modality-ts/properties";

export const useSupportCase = {
  // state
  data: variable("swr:useSupportCase:data") as Variable<
    {
      readonly kind: "option";
      readonly inner: { readonly kind: "tokens"; readonly count: 1 };
    },
    "swr:useSupportCase:data"
  >,
  error: variable("swr:useSupportCase:error") as Variable<
    { readonly kind: "bool" },
    "swr:useSupportCase:error"
  >,
  isValidating: variable("swr:useSupportCase:isValidating") as Variable<
    { readonly kind: "bool" },
    "swr:useSupportCase:isValidating"
  >,

  // transitions
  fetch:
    "swr:useSupportCase:fetch" as TransitionRef<"swr:useSupportCase:fetch">,
  resolve: {
    error:
      "swr:useSupportCase:resolve:error" as TransitionRef<"swr:useSupportCase:resolve:error">,
    success: {
      "0": "swr:useSupportCase:resolve:success:0" as TransitionRef<"swr:useSupportCase:resolve:success:0">,
    },
  },
};
