import { create } from "zustand";
import type { AccountId } from "../../../../shared/features/accounts/domain/account.js";
import type { AsyncStatus } from "../../../../shared/features/fixtures/domain/fixtures.js";
import type { SupportPriority } from "../../../../shared/features/support/domain/escalation.js";

type SupportState = {
  priority: SupportPriority;
  escalationStatus: AsyncStatus;
  enqueuedAccountId: AccountId | null;
  activeAccountId: AccountId;
  setPriority: (priority: SupportPriority) => void;
  openEscalation: (accountId: AccountId) => void;
  assignOwner: (accountId: AccountId) => void;
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
