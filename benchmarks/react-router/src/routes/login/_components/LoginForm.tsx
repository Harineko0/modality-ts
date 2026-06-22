import { useAtom, useAtomValue } from "jotai";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  permissionsForRole,
  roleHasPermission,
} from "../../../../shared/features/auth/domain/rbac.js";
import { loginFormSchema } from "../../../../shared/features/auth/domain/session.schema.js";
import type { Role } from "../../../../shared/features/fixtures/domain/fixtures.js";
import { api } from "../../../features/auth/infra/api.js";
import {
  loginStatusAtom,
  permissionCacheAtom,
  returnToAtom,
  sessionAtom,
} from "../../../features/auth/state/session-atoms.js";

const roles: Role[] = ["analyst", "manager", "admin"];

export function LoginForm() {
  const [role, setRole] = useState<Role>("manager");
  const [email, setEmail] = useState("manager@ledger.test");
  const [password, setPassword] = useState("ledger-pass");
  const [loginStatus, setLoginStatus] = useAtom(loginStatusAtom);
  const [session, setSession] = useAtom(sessionAtom);
  const [permissionCache, setPermissionCache] = useAtom(permissionCacheAtom);
  const returnTo = useAtomValue(returnToAtom);
  const navigate = useNavigate();

  const handleLogin = async () => {
    const parsed = loginFormSchema.safeParse({ role, email, password });
    if (!parsed.success) {
      setLoginStatus("error");
      return;
    }
    setLoginStatus("submitting");
    const previousRole = permissionCache?.role ?? "guest";
    const result = await api.login(parsed.data);
    if (result.status === "error") {
      setLoginStatus("error");
      return;
    }
    setSession(result.session);
    setPermissionCache({
      role: previousRole,
      permissions: permissionsForRole(previousRole),
    });
    setLoginStatus("success");
    if (
      permissionCache &&
      roleHasPermission(permissionCache.role, "manage_rbac")
    ) {
      navigate(returnTo);
      return;
    }
    navigate("/dashboard");
  };

  return (
    <section>
      <fieldset aria-label="role segmented control">
        {roles.map((entry) => (
          <button
            key={entry}
            type="button"
            aria-pressed={role === entry}
            onClick={() => setRole(entry)}
          >
            {entry}
          </button>
        ))}
      </fieldset>
      <label>
        email field
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label>
        password field
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <button type="button" onClick={handleLogin}>
        Login
      </button>
      {loginStatus === "error" ? <div>login error banner</div> : null}
      <p>return-path notice: {returnTo}</p>
      <output>{session?.role ?? "guest"}</output>
    </section>
  );
}
