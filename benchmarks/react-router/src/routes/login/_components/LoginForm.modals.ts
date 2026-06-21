import { variable, type Variable } from "modality-ts/core";
import type { TransitionRef } from "modality-ts/properties";

export const LoginForm = {
  // state
  email: variable("local:LoginForm.email") as Variable<{ readonly kind: "enum"; readonly values: readonly ["manager@ledger.test"] }, "local:LoginForm.email">,
  password: variable("local:LoginForm.password") as Variable<{ readonly kind: "enum"; readonly values: readonly ["ledger-pass"] }, "local:LoginForm.password">,
  role: variable("local:LoginForm.role") as Variable<{ readonly kind: "enum"; readonly values: readonly ["admin", "analyst", "guest", "manager"] }, "local:LoginForm.role">,

  // transitions
  onChange: {
    email: {
      manager_ledger_test: "LoginForm.onChange.email.manager_ledger_test" as TransitionRef<"LoginForm.onChange.email.manager_ledger_test">,
    },
    password: {
      ledger_pass: "LoginForm.onChange.password.ledger_pass" as TransitionRef<"LoginForm.onChange.password.ledger_pass">,
    },
  },
  onClick: {
    handleLogin: "LoginForm.onClick.handleLogin" as TransitionRef<"LoginForm.onClick.handleLogin">,
    role: {
      unrepresentable: "LoginForm.onClick.role.unrepresentable" as TransitionRef<"LoginForm.onClick.role.unrepresentable">,
    },
  },
};
