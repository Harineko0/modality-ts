import type { TransitionRef } from "modality-ts/properties";

export const AccountList = {
  // transitions
  onChange: {
    selectedAccountAtom: {
      unrepresentable: "AccountList.onChange.selectedAccountAtom.unrepresentable" as TransitionRef<"AccountList.onChange.selectedAccountAtom.unrepresentable">,
    },
  },
};
