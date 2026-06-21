import { variable, type Variable } from "modality-ts/core";
import type { TransitionRef } from "modality-ts/properties";

export const App = {
  // state
  auth: variable("local:App.auth") as Variable<{ readonly kind: "enum"; readonly values: readonly ["guest", "user"] }, "local:App.auth">,
  paymentMethod: variable("local:App.paymentMethod") as Variable<{ readonly kind: "enum"; readonly values: readonly ["none", "valid"] }, "local:App.paymentMethod">,
  plan: variable("local:App.plan") as Variable<{ readonly kind: "enum"; readonly values: readonly ["none", "pro", "starter"] }, "local:App.plan">,
  quoteStatus: variable("local:App.quoteStatus") as Variable<{ readonly kind: "enum"; readonly values: readonly ["invalid", "loading", "missing", "valid"] }, "local:App.quoteStatus">,
  step: variable("local:App.step") as Variable<{ readonly kind: "enum"; readonly values: readonly ["billing", "plan", "review", "success"] }, "local:App.step">,
  submitStatus: variable("local:App.submitStatus") as Variable<{ readonly kind: "enum"; readonly values: readonly ["failed", "idle", "submitting"] }, "local:App.submitStatus">,
  userId: variable("local:App.userId") as Variable<{ readonly kind: "enum"; readonly values: readonly ["none", "u1"] }, "local:App.userId">,

  // transitions
  onClick: {
    "Back to plans": "App.onClick.Back to plans" as TransitionRef<"App.onClick.Back to plans">,
    Billing: "App.onClick.Billing" as TransitionRef<"App.onClick.Billing">,
    Login: "App.onClick.Login" as TransitionRef<"App.onClick.Login">,
    Logout: "App.onClick.Logout" as TransitionRef<"App.onClick.Logout">,
    Pro: "App.onClick.Pro" as TransitionRef<"App.onClick.Pro">,
    "Review order": "App.onClick.Review order" as TransitionRef<"App.onClick.Review order">,
    Starter: "App.onClick.Starter" as TransitionRef<"App.onClick.Starter">,
    "Submit order": "App.onClick.Submit order" as TransitionRef<"App.onClick.Submit order">,
    "Use card": "App.onClick.Use card" as TransitionRef<"App.onClick.Use card">,
  },
};
