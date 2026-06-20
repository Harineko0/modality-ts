import { useSetAtom, useAtomValue } from "jotai";
import {
  loginStatusAtom,
  permissionCacheAtom,
  returnToAtom,
  sessionAtom,
} from "../state/session-atoms.js";
import { permissionsForRole } from "../../../../shared/features/auth/domain/rbac.js";
import { api } from "../infra/api.js";

export function useAuthActions() {
  const setSession = useSetAtom(sessionAtom);
  const setPermissionCache = useSetAtom(permissionCacheAtom);
  const setLoginStatus = useSetAtom(loginStatusAtom);
  const previousCache = useAtomValue(permissionCacheAtom);
  const returnTo = useAtomValue(returnToAtom);

  const completeLogin = async (input: {
    role: "analyst" | "manager" | "admin";
    email: string;
    password: string;
  }) => {
    setLoginStatus("submitting");
    const result = await api.login(input);
    if (result.status === "error") {
      setLoginStatus("error");
      return { ok: false as const, returnTo };
    }
    const staleRole = previousCache?.role ?? "guest";
    setSession(result.session);
    setPermissionCache({
      role: staleRole,
      permissions: permissionsForRole(staleRole),
    });
    setLoginStatus("success");
    return { ok: true as const, returnTo };
  };

  return { completeLogin };
}
