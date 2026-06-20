import { variable, type Variable } from "modality-ts/core";
import type { TransitionRef } from "modality-ts/properties";

// state
export const auth: Variable<{ readonly kind: "enum"; readonly values: readonly ["guest", "user"] }, "local:App.auth"> = variable("local:App.auth") as Variable<{ readonly kind: "enum"; readonly values: readonly ["guest", "user"] }, "local:App.auth">;
export const paymentMethod: Variable<{ readonly kind: "enum"; readonly values: readonly ["none", "valid"] }, "local:App.paymentMethod"> = variable("local:App.paymentMethod") as Variable<{ readonly kind: "enum"; readonly values: readonly ["none", "valid"] }, "local:App.paymentMethod">;
export const plan: Variable<{ readonly kind: "enum"; readonly values: readonly ["none", "pro", "starter"] }, "local:App.plan"> = variable("local:App.plan") as Variable<{ readonly kind: "enum"; readonly values: readonly ["none", "pro", "starter"] }, "local:App.plan">;
export const quoteStatus: Variable<{ readonly kind: "enum"; readonly values: readonly ["invalid", "loading", "missing", "valid"] }, "local:App.quoteStatus"> = variable("local:App.quoteStatus") as Variable<{ readonly kind: "enum"; readonly values: readonly ["invalid", "loading", "missing", "valid"] }, "local:App.quoteStatus">;
export const step: Variable<{ readonly kind: "enum"; readonly values: readonly ["billing", "plan", "review", "success"] }, "local:App.step"> = variable("local:App.step") as Variable<{ readonly kind: "enum"; readonly values: readonly ["billing", "plan", "review", "success"] }, "local:App.step">;
export const submitStatus: Variable<{ readonly kind: "enum"; readonly values: readonly ["failed", "idle", "submitting"] }, "local:App.submitStatus"> = variable("local:App.submitStatus") as Variable<{ readonly kind: "enum"; readonly values: readonly ["failed", "idle", "submitting"] }, "local:App.submitStatus">;
export const userId: Variable<{ readonly kind: "enum"; readonly values: readonly ["none", "u1"] }, "local:App.userId"> = variable("local:App.userId") as Variable<{ readonly kind: "enum"; readonly values: readonly ["none", "u1"] }, "local:App.userId">;

// transitions
export const App = {
  onClick: {
    api: {
      fetchQuote: {
        start: "App.onClick.api.fetchQuote.start" as TransitionRef<"App.onClick.api.fetchQuote.start">,
        success: "App.onClick.api.fetchQuote.success" as TransitionRef<"App.onClick.api.fetchQuote.success">,
      },
      submitOrder: {
        error: "App.onClick.api.submitOrder.error" as TransitionRef<"App.onClick.api.submitOrder.error">,
        start: "App.onClick.api.submitOrder.start" as TransitionRef<"App.onClick.api.submitOrder.start">,
        success: "App.onClick.api.submitOrder.success" as TransitionRef<"App.onClick.api.submitOrder.success">,
      },
    },
    "Back to plans": "App.onClick.Back to plans" as TransitionRef<"App.onClick.Back to plans">,
    Billing: "App.onClick.Billing" as TransitionRef<"App.onClick.Billing">,
    Login: "App.onClick.Login" as TransitionRef<"App.onClick.Login">,
    Logout: "App.onClick.Logout" as TransitionRef<"App.onClick.Logout">,
    "Review order": "App.onClick.Review order" as TransitionRef<"App.onClick.Review order">,
    Starter: "App.onClick.Starter" as TransitionRef<"App.onClick.Starter">,
    "Use card": "App.onClick.Use card" as TransitionRef<"App.onClick.Use card">,
  },
};
