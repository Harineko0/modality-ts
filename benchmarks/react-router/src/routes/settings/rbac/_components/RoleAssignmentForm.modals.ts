import type { TransitionRef } from "modality-ts/properties";

export const RoleAssignmentForm = {
  // transitions
  onChange: {
    targetRoleAtom: {
      unrepresentable: "RoleAssignmentForm.onChange.targetRoleAtom.unrepresentable" as TransitionRef<"RoleAssignmentForm.onChange.targetRoleAtom.unrepresentable">,
    },
  },
  onClick: {
    "save role assignment button": "RoleAssignmentForm.onClick.save role assignment button" as TransitionRef<"RoleAssignmentForm.onClick.save role assignment button">,
  },
};
