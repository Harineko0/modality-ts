import type { ReactNode } from "react";
import { useAtomValue } from "jotai";
import { permissionCacheAtom } from "../state/session-atoms.js";
import type { Permission } from "../../../../shared/features/fixtures/domain/fixtures.js";
import { roleHasPermission } from "../../../../shared/features/auth/domain/rbac.js";

type Props = {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
};

export function PermissionGate({
  permission,
  children,
  fallback = null,
}: Props) {
  const cache = useAtomValue(permissionCacheAtom);
  if (!cache || !roleHasPermission(cache.role, permission)) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}
