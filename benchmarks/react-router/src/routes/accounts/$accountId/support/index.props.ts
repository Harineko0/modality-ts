import {
  alwaysStep,
  eq,
  group,
  neq,
  readOpArg,
  stepResolved,
} from "modality-ts/properties";
import { useSupportStore } from "../../../../features/support/state/support-store.modals";

const enqueuedAccountId = useSupportStore.enqueuedAccountId;
const activeAccountId = useSupportStore.activeAccountId;

group("support", () => {
  alwaysStep("support.escalationUsesEnqueuedAccount", {
    negate: true,
    step: stepResolved("api.openSupportEscalation"),
    post: neq(readOpArg("accountId"), enqueuedAccountId),
  });

  alwaysStep("support.assignUsesDisplayedAccount", {
    step: stepResolved("api.openSupportEscalation"),
    post: eq(activeAccountId, enqueuedAccountId),
  });
});
