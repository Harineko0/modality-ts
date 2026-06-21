import { variable, type Variable } from "modality-ts/core";

export const accountDetailTabAtom: Variable<{ readonly kind: "enum"; readonly values: readonly ["billing", "payment-methods", "subscription", "support"] }, "atom:accountDetailTabAtom"> = variable("atom:accountDetailTabAtom");

export const accountStatusFilterAtom: Variable<{ readonly kind: "enum"; readonly values: readonly ["active", "all", "past_due", "suspended", "trial"] }, "atom:accountStatusFilterAtom"> = variable("atom:accountStatusFilterAtom");

export const selectedAccountAtom: Variable<{ readonly kind: "enum"; readonly values: readonly ["acct-alpha", "acct-beta", "acct-gamma"] }, "atom:selectedAccountAtom"> = variable("atom:selectedAccountAtom");

export const selectedInvoiceAtom: Variable<{ readonly kind: "enum"; readonly values: readonly ["inv-100", "inv-200", "inv-300"] }, "atom:selectedInvoiceAtom"> = variable("atom:selectedInvoiceAtom");
