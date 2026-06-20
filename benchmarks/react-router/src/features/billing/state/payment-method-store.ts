import { create } from "zustand";
import type {
  AsyncStatus,
  PaymentMethodStatus,
} from "../../../../shared/features/fixtures/domain/fixtures.js";

type PaymentMethodState = {
  methodStatus: PaymentMethodStatus;
  saveStatus: AsyncStatus;
  setMethodStatus: (status: PaymentMethodStatus) => void;
  markSaved: () => void;
};

export const usePaymentMethodStore = create<PaymentMethodState>((set) => ({
  methodStatus: "valid",
  saveStatus: "idle",
  setMethodStatus: (status) => set({ methodStatus: status }),
  markSaved: () => set({ saveStatus: "success" }),
}));
