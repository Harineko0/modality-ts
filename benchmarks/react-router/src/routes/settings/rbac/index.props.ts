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
  variable,
} from "modality-ts/properties";
import { route } from "modality-ts/vars";

const sessionRole = variable("atom:sessionAtom").at("role");
const permissionRole = variable("atom:permissionCacheAtom").at("role");
const targetRole = variable("atom:targetRoleAtom");

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
