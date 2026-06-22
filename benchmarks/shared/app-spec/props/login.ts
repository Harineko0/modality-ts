import {
  always,
  alwaysStep,
  and,
  ctl,
  eq,
  group,
  leadsToWithin,
  neq,
  or,
  pre,
  property,
  reachable,
  readOpArg,
  s,
  stepAny,
  stepEnqueued,
  stepResolved,
  stepTransitionId,
  variable,
} from "modality-ts/properties";
import { pending, route } from "modality-ts/vars";

const sessionRole = variable("atom:sessionAtom").at("role");
const _permissionRole = variable("atom:permissionCacheAtom").at("role");
const returnTo = variable("atom:returnToAtom");
const loginRole = s({ name: "LoginForm" }).role;

group("auth", () => {
  alwaysStep("auth.failedLoginKeepsGuest", {
    negate: true,
    step: stepResolved("api.login", "error"),
    post: neq(sessionRole, "guest"),
  });

  alwaysStep("auth.managerCannotLandOnAdminReturnTo", {
    negate: true,
    step: stepResolved("api.login", "success"),
    post: and(eq(route, "/settings/rbac"), eq(sessionRole, "manager")),
  });

  leadsToWithin(
    "auth.loginSettlesWithinTwoEnvironmentSteps",
    stepEnqueued("api.login"),
    or(eq(route, "/dashboard"), eq(route, "/settings/rbac")),
    { budget: { environment: 2 } },
  );

  property(
    "auth.loginLoadingHoldsUntilOutcome",
    ctl.holdsUntil(
      ctl.holds(eq(pending.at("0", "opId"), "api.login")),
      ctl.holds(neq(sessionRole, "guest")),
    ),
  );

  reachable("auth.loginWorkflowReachable", eq(route, "/login"));

  property(
    "auth.guestCannotNavigateToForbiddenAdminRoute",
    ctl.implies(
      ctl.holds(eq(sessionRole, "guest")),
      ctl.negate(ctl.holds(eq(route, "/settings/rbac"))),
    ),
  );

  alwaysStep("auth.loginEnqueueSnapshot", {
    step: stepEnqueued("api.login"),
    post: eq(readOpArg("role"), loginRole),
  });

  alwaysStep("auth.loginResolveDoesNotMutateReturnPath", {
    negate: true,
    step: stepResolved("api.login"),
    pre: eq(returnTo, "/settings/rbac"),
    post: neq(returnTo, pre(returnTo)),
  });

  property(
    "auth.noForeverLoginLoading",
    ctl.negate(
      ctl.canStayForever(ctl.holds(eq(pending.at("0", "opId"), "api.login"))),
    ),
  );

  always(
    "auth.noDuplicatePendingLogin",
    eq(pending.at("0", "opId"), pending.at("0", "opId")),
  );

  stepTransitionId("LoginForm.onClick.handleLogin");
  stepAny();
});
