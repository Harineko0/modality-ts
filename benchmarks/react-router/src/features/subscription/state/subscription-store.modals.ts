import { variable, type Variable } from "modality-ts/core";

export const useSubscriptionStore = {
  // state
  approvalStatus: variable("zustand:useSubscriptionStore.approvalStatus") as Variable<{ readonly kind: "enum"; readonly values: readonly ["none"] }, "zustand:useSubscriptionStore.approvalStatus">,
  planDraft: variable("zustand:useSubscriptionStore.planDraft") as Variable<{ readonly kind: "enum"; readonly values: readonly ["growth"] }, "zustand:useSubscriptionStore.planDraft">,
  requestSnapshot: variable("zustand:useSubscriptionStore.requestSnapshot") as Variable<{ readonly kind: "option"; readonly inner: { readonly kind: "tokens"; readonly count: 1 } }, "zustand:useSubscriptionStore.requestSnapshot">,
  seatDraft: variable("zustand:useSubscriptionStore.seatDraft") as Variable<{ readonly kind: "boundedInt"; readonly min: 12; readonly max: 12 }, "zustand:useSubscriptionStore.seatDraft">,
};
