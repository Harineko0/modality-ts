import { variable, type Variable } from "modality-ts/core";

export const loginStatusAtom: Variable<{ readonly kind: "enum"; readonly values: readonly ["error", "idle", "loading", "submitting", "success"] }, "atom:loginStatusAtom"> = variable("atom:loginStatusAtom");

export const permissionCacheAtom: Variable<{ readonly kind: "option"; readonly inner: { readonly kind: "record"; readonly fields: { readonly role: { readonly kind: "enum"; readonly values: readonly ["admin", "analyst", "guest", "manager"] }; readonly permissions: { readonly kind: "lengthCat" } } } }, "atom:permissionCacheAtom"> = variable("atom:permissionCacheAtom");

export const returnToAtom: Variable<{ readonly kind: "tokens"; readonly count: 1 }, "atom:returnToAtom"> = variable("atom:returnToAtom");

export const roleSaveStatusAtom: Variable<{ readonly kind: "enum"; readonly values: readonly ["error", "idle", "loading", "submitting", "success"] }, "atom:roleSaveStatusAtom"> = variable("atom:roleSaveStatusAtom");

export const sessionAtom: Variable<{ readonly kind: "option"; readonly inner: { readonly kind: "record"; readonly fields: { readonly userId: { readonly kind: "tokens"; readonly count: 1 }; readonly email: { readonly kind: "tokens"; readonly count: 1 }; readonly role: { readonly kind: "enum"; readonly values: readonly ["admin", "analyst", "guest", "manager"] } } } }, "atom:sessionAtom"> = variable("atom:sessionAtom");

export const targetRoleAtom: Variable<{ readonly kind: "enum"; readonly values: readonly ["admin", "analyst", "guest", "manager"] }, "atom:targetRoleAtom"> = variable("atom:targetRoleAtom");
