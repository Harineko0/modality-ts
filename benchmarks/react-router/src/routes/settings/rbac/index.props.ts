import {
  always,
  and,
  ctl,
  enabled,
  eq,
  group,
  not,
  or,
  property,
  reachableFrom,
  stepAny,
} from "modality-ts/properties";
import { route } from "modality-ts/vars";
import {
  permissionCacheAtom,
  sessionAtom,
  targetRoleAtom,
} from "../../../features/auth/state/session-atoms.modals";

const sessionRole = sessionAtom.at("role");
const permissionRole = permissionCacheAtom.at("role");
const targetRole = targetRoleAtom;

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

  // The save control only renders on the RBAC route, so its enablement
  // guarantee holds there rather than globally.
  always(
    "rbac.saveRoleAssignmentGuard",
    or(
      not(eq(route, "/settings/rbac")),
      enabled("RoleAssignmentForm.onClick.save role assignment button"),
    ),
  );

  stepAny();
});
