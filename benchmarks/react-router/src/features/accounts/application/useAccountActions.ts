import { useSetAtom } from "jotai";
import type { AccountId } from "../../../../shared/features/accounts/domain/account.js";
import {
  selectedAccountAtom,
  selectedInvoiceAtom,
} from "../state/selection-atoms.js";

export function useAccountActions() {
  const setSelectedAccount = useSetAtom(selectedAccountAtom);
  const setSelectedInvoice = useSetAtom(selectedInvoiceAtom);

  return {
    selectAccount: (accountId: AccountId) => setSelectedAccount(accountId),
    selectInvoice: (invoiceId: "inv-100" | "inv-200" | "inv-300") =>
      setSelectedInvoice(invoiceId),
  };
}
