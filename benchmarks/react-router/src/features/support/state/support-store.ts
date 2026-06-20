import { create } from "zustand";
import type { AsyncStatus } from "../../../../shared/features/fixtures/domain/fixtures.js";
import type { SupportPriority } from "../../../../shared/features/support/domain/escalation.js";

type SupportState = {
  priority: SupportPriority;
  escalationStatus: AsyncStatus;
  enqueuedAccountId: string | null;
  activeAccountId: string;
  setPriority: (priority: SupportPriority) => void;
  openEscalation: (accountId: string) => void;
  assignOwner: (accountId: string) => void;
};

export const useSupportStore = create<SupportState>((set, get) => ({
  priority: "normal",
  escalationStatus: "idle",
  enqueuedAccountId: null,
  activeAccountId: "acct-alpha",
  setPriority: (priority) => set({ priority }),
  openEscalation: (accountId) =>
    set({ escalationStatus: "submitting", enqueuedAccountId: accountId }),
  assignOwner: (_accountId) => {
    const current = get().activeAccountId;
    set({ escalationStatus: "success", activeAccountId: current });
  },
}));
