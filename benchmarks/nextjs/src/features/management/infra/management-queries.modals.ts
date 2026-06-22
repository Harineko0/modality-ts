import { type Variable, variable } from "modality-ts/core";
import type { TransitionRef } from "modality-ts/properties";

export const useManagementSummary = {
  // state
  data: variable("swr:useManagementSummary:data") as Variable<
    {
      readonly kind: "option";
      readonly inner: { readonly kind: "tokens"; readonly count: 1 };
    },
    "swr:useManagementSummary:data"
  >,
  error: variable("swr:useManagementSummary:error") as Variable<
    { readonly kind: "bool" },
    "swr:useManagementSummary:error"
  >,
  isValidating: variable("swr:useManagementSummary:isValidating") as Variable<
    { readonly kind: "bool" },
    "swr:useManagementSummary:isValidating"
  >,

  // transitions
  fetch:
    "swr:useManagementSummary:fetch" as TransitionRef<"swr:useManagementSummary:fetch">,
  resolve: {
    error:
      "swr:useManagementSummary:resolve:error" as TransitionRef<"swr:useManagementSummary:resolve:error">,
    success: {
      "0": "swr:useManagementSummary:resolve:success:0" as TransitionRef<"swr:useManagementSummary:resolve:success:0">,
    },
  },
};

export const useOperationsQueue = {
  // state
  data: variable("swr:useOperationsQueue:data") as Variable<
    {
      readonly kind: "option";
      readonly inner: { readonly kind: "tokens"; readonly count: 1 };
    },
    "swr:useOperationsQueue:data"
  >,
  error: variable("swr:useOperationsQueue:error") as Variable<
    { readonly kind: "bool" },
    "swr:useOperationsQueue:error"
  >,
  isValidating: variable("swr:useOperationsQueue:isValidating") as Variable<
    { readonly kind: "bool" },
    "swr:useOperationsQueue:isValidating"
  >,

  // transitions
  fetch:
    "swr:useOperationsQueue:fetch" as TransitionRef<"swr:useOperationsQueue:fetch">,
  resolve: {
    error:
      "swr:useOperationsQueue:resolve:error" as TransitionRef<"swr:useOperationsQueue:resolve:error">,
    success: {
      "0": "swr:useOperationsQueue:resolve:success:0" as TransitionRef<"swr:useOperationsQueue:resolve:success:0">,
    },
  },
};

export const useRevenueQueue = {
  // state
  data: variable("swr:useRevenueQueue:data") as Variable<
    {
      readonly kind: "option";
      readonly inner: { readonly kind: "tokens"; readonly count: 1 };
    },
    "swr:useRevenueQueue:data"
  >,
  error: variable("swr:useRevenueQueue:error") as Variable<
    { readonly kind: "bool" },
    "swr:useRevenueQueue:error"
  >,
  isValidating: variable("swr:useRevenueQueue:isValidating") as Variable<
    { readonly kind: "bool" },
    "swr:useRevenueQueue:isValidating"
  >,

  // transitions
  fetch:
    "swr:useRevenueQueue:fetch" as TransitionRef<"swr:useRevenueQueue:fetch">,
  resolve: {
    error:
      "swr:useRevenueQueue:resolve:error" as TransitionRef<"swr:useRevenueQueue:resolve:error">,
    success: {
      "0": "swr:useRevenueQueue:resolve:success:0" as TransitionRef<"swr:useRevenueQueue:resolve:success:0">,
    },
  },
};

export const useRiskQueue = {
  // state
  data: variable("swr:useRiskQueue:data") as Variable<
    {
      readonly kind: "option";
      readonly inner: { readonly kind: "tokens"; readonly count: 1 };
    },
    "swr:useRiskQueue:data"
  >,
  error: variable("swr:useRiskQueue:error") as Variable<
    { readonly kind: "bool" },
    "swr:useRiskQueue:error"
  >,
  isValidating: variable("swr:useRiskQueue:isValidating") as Variable<
    { readonly kind: "bool" },
    "swr:useRiskQueue:isValidating"
  >,

  // transitions
  fetch: "swr:useRiskQueue:fetch" as TransitionRef<"swr:useRiskQueue:fetch">,
  resolve: {
    error:
      "swr:useRiskQueue:resolve:error" as TransitionRef<"swr:useRiskQueue:resolve:error">,
    success: {
      "0": "swr:useRiskQueue:resolve:success:0" as TransitionRef<"swr:useRiskQueue:resolve:success:0">,
    },
  },
};
