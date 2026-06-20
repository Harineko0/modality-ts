import {
  always,
  and,
  ctl,
  enabled,
  eq,
  group,
  not,
  property,
  reachableFrom,
  stepAny,
  type Variable,
} from "modality-ts/properties";
import { route } from "modality-ts/vars";
import {
  permissionCacheAtom,
  sessionAtom,
  targetRoleAtom,
} from "../../../features/auth/state/session-atoms.js";

const sessionRole = (sessionAtom as unknown as Variable).at("role");
const permissionRole = (permissionCacheAtom as unknown as Variable).at("role");
const targetRole = targetRoleAtom as unknown as Variable;

group("rbac", () => {
  always(
    "rbac.permissionCacheMatchesCurrentRole",
    eq(sessionRole, permissionRole),
  );

  always(
    "rbac.analystCannotSaveRoleAssignment",
    not(
      and(
        eq(targetRole, "admin"),
        eq(permissionRole, "analyst"),
        enabled("RoleAssignmentForm.onClick.save role assignment button"),
      ),
    ),
  );

  reachableFrom(
    "rbac.adminCanReachRoleManagement",
    eq(permissionRole, "admin"),
    eq(route, "/settings/rbac"),
  );

  property(
    "rbac.permissionCacheConsistency",
    ctl.afterEveryStep(ctl.holds(eq(sessionRole, permissionRole))),
  );

  always(
    "rbac.saveRoleAssignmentGuard",
    enabled("RoleAssignmentForm.onClick.save role assignment button"),
  );

  stepAny();
});
