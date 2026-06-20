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
    auth_paymentMethod_plan_quoteStatus_step_submitStatus_userId: {
      seq: "App.onClick.auth_paymentMethod_plan_quoteStatus_step_submitStatus_userId.seq" as TransitionRef<"App.onClick.auth_paymentMethod_plan_quoteStatus_step_submitStatus_userId.seq">,
    },
    auth_userId: {
      seq: "App.onClick.auth_userId.seq" as TransitionRef<"App.onClick.auth_userId.seq">,
    },
    paymentMethod: "App.onClick.paymentMethod" as TransitionRef<"App.onClick.paymentMethod">,
    plan_quoteStatus: {
      seq: "App.onClick.plan_quoteStatus.seq" as TransitionRef<"App.onClick.plan_quoteStatus.seq">,
    },
    step: {
      "3k1mh1": "App.onClick.step.3k1mh1" as TransitionRef<"App.onClick.step.3k1mh1">,
      my8cwv: "App.onClick.step.my8cwv" as TransitionRef<"App.onClick.step.my8cwv">,
      ny1ruq: "App.onClick.step.ny1ruq" as TransitionRef<"App.onClick.step.ny1ruq">,
    },
  },
};
