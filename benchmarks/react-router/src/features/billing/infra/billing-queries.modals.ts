import { type Variable, variable } from "modality-ts/core";
import type { TransitionRef } from "modality-ts/properties";

export const useBillingAccount = {
  // state
  data: variable("swr:useBillingAccount:data") as Variable<
    {
      readonly kind: "option";
      readonly inner: { readonly kind: "tokens"; readonly count: 1 };
    },
    "swr:useBillingAccount:data"
  >,
  error: variable("swr:useBillingAccount:error") as Variable<
    { readonly kind: "bool" },
    "swr:useBillingAccount:error"
  >,
  isValidating: variable("swr:useBillingAccount:isValidating") as Variable<
    { readonly kind: "bool" },
    "swr:useBillingAccount:isValidating"
  >,

  // transitions
  fetch:
    "swr:useBillingAccount:fetch" as TransitionRef<"swr:useBillingAccount:fetch">,
  resolve: {
    error:
      "swr:useBillingAccount:resolve:error" as TransitionRef<"swr:useBillingAccount:resolve:error">,
    success: {
      "0": "swr:useBillingAccount:resolve:success:0" as TransitionRef<"swr:useBillingAccount:resolve:success:0">,
    },
  },
};

export const useInvoiceDetail = {
  // state
  data: variable("swr:useInvoiceDetail:data") as Variable<
    {
      readonly kind: "option";
      readonly inner: { readonly kind: "tokens"; readonly count: 1 };
    },
    "swr:useInvoiceDetail:data"
  >,
  error: variable("swr:useInvoiceDetail:error") as Variable<
    { readonly kind: "bool" },
    "swr:useInvoiceDetail:error"
  >,
  isValidating: variable("swr:useInvoiceDetail:isValidating") as Variable<
    { readonly kind: "bool" },
    "swr:useInvoiceDetail:isValidating"
  >,

  // transitions
  fetch:
    "swr:useInvoiceDetail:fetch" as TransitionRef<"swr:useInvoiceDetail:fetch">,
  resolve: {
    error:
      "swr:useInvoiceDetail:resolve:error" as TransitionRef<"swr:useInvoiceDetail:resolve:error">,
    success: {
      "0": "swr:useInvoiceDetail:resolve:success:0" as TransitionRef<"swr:useInvoiceDetail:resolve:success:0">,
    },
  },
};

export const usePaymentMethods = {
  // state
  data: variable("swr:usePaymentMethods:data") as Variable<
    {
      readonly kind: "option";
      readonly inner: { readonly kind: "tokens"; readonly count: 1 };
    },
    "swr:usePaymentMethods:data"
  >,
  error: variable("swr:usePaymentMethods:error") as Variable<
    { readonly kind: "bool" },
    "swr:usePaymentMethods:error"
  >,
  isValidating: variable("swr:usePaymentMethods:isValidating") as Variable<
    { readonly kind: "bool" },
    "swr:usePaymentMethods:isValidating"
  >,

  // transitions
  fetch:
    "swr:usePaymentMethods:fetch" as TransitionRef<"swr:usePaymentMethods:fetch">,
  resolve: {
    error:
      "swr:usePaymentMethods:resolve:error" as TransitionRef<"swr:usePaymentMethods:resolve:error">,
    success: {
      "0": "swr:usePaymentMethods:resolve:success:0" as TransitionRef<"swr:usePaymentMethods:resolve:success:0">,
    },
  },
};
