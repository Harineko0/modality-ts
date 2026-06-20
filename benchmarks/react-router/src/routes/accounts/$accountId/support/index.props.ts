import {
  alwaysStep,
  eq,
  group,
  neq,
  readOpArg,
  stepResolved,
  variable,
} from "modality-ts/properties";

const enqueuedAccountId = variable("zustand:useSupportStore.enqueuedAccountId");
const activeAccountId = variable("zustand:useSupportStore.activeAccountId");

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
