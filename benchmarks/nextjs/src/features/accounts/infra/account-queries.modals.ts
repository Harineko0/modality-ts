import { type Variable, variable } from "modality-ts/core";
import type { TransitionRef } from "modality-ts/properties";

export const useAccountDetail = {
  // state
  data: variable("swr:useAccountDetail:data") as Variable<
    {
      readonly kind: "option";
      readonly inner: { readonly kind: "tokens"; readonly count: 1 };
    },
    "swr:useAccountDetail:data"
  >,
  error: variable("swr:useAccountDetail:error") as Variable<
    { readonly kind: "bool" },
    "swr:useAccountDetail:error"
  >,
  isValidating: variable("swr:useAccountDetail:isValidating") as Variable<
    { readonly kind: "bool" },
    "swr:useAccountDetail:isValidating"
  >,

  // transitions
  fetch:
    "swr:useAccountDetail:fetch" as TransitionRef<"swr:useAccountDetail:fetch">,
  resolve: {
    error:
      "swr:useAccountDetail:resolve:error" as TransitionRef<"swr:useAccountDetail:resolve:error">,
    success: {
      "0": "swr:useAccountDetail:resolve:success:0" as TransitionRef<"swr:useAccountDetail:resolve:success:0">,
    },
  },
};
