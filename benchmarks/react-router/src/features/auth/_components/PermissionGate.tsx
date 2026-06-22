import { useAtomValue } from "jotai";
import type { ReactNode } from "react";
import { roleHasPermission } from "../../../../shared/features/auth/domain/rbac.js";
import type { Permission } from "../../../../shared/features/fixtures/domain/fixtures.js";
import { permissionCacheAtom } from "../state/session-atoms.js";

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
