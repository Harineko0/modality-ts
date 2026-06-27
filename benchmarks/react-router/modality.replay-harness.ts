import { createStore, Provider as JotaiProvider } from "jotai";
import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { SWRConfig } from "swr";
import {
  type BenchmarkReplayContext,
  createBenchmarkReplayHarness,
} from "../shared/testing/replay-harness.js";
import {
  accountDetailTabAtom,
  accountStatusFilterAtom,
  selectedAccountAtom,
  selectedInvoiceAtom,
} from "./src/features/accounts/state/selection-atoms.js";
import {
  auditActionFilterAtom,
  auditActorRoleFilterAtom,
  auditExportStatusAtom,
} from "./src/features/audit/state/audit-atoms.js";
import {
  loginStatusAtom,
  permissionCacheAtom,
  returnToAtom,
  roleSaveStatusAtom,
  sessionAtom,
  targetRoleAtom,
} from "./src/features/auth/state/session-atoms.js";
import { useBillingStore } from "./src/features/billing/state/billing-store.js";
import { useInvoiceStore } from "./src/features/billing/state/invoice-store.js";
import { usePaymentMethodStore } from "./src/features/billing/state/payment-method-store.js";
import {
  managementFilterAtom,
  managementTabAtom,
} from "./src/features/management/state/management-atoms.js";
import { useManagementStore } from "./src/features/management/state/management-store.js";
import { useSettingsStore } from "./src/features/settings/state/settings-store.js";
import { useApprovalStore } from "./src/features/subscription/state/approval-store.js";
import { useSubscriptionStore } from "./src/features/subscription/state/subscription-store.js";
import { useSupportStore } from "./src/features/support/state/support-store.js";

// Some TSX replay imports are evaluated through the CI tsx loader rather than
// the benchmark app's bundler, so expose React for classic JSX output.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const atomByName = {
  accountDetailTabAtom,
  accountStatusFilterAtom,
  auditActionFilterAtom,
  auditActorRoleFilterAtom,
  auditExportStatusAtom,
  loginStatusAtom,
  managementFilterAtom,
  managementTabAtom,
  permissionCacheAtom,
  returnToAtom,
  roleSaveStatusAtom,
  selectedAccountAtom,
  selectedInvoiceAtom,
  sessionAtom,
  targetRoleAtom,
};

const harness = createBenchmarkReplayHarness({
  initialRoute: "/login",
  async mount(context) {
    registerLedgerOpsRuntimeStores(context);
    const { routes } = await import("./src/app/router.js");
    const store = createStore();
    const router = createMemoryRouter(routes, {
      initialEntries: [context.initialRoute],
    });
    const historyStack: string[] = [];
    const root = createRoot(context.container);
    flushSync(() => {
      root.render(
        React.createElement(
          JotaiProvider,
          { store },
          React.createElement(
            SWRConfig,
            {
              value: {
                dedupingInterval: 0,
                provider: () => context.swrCache,
                fetcher: async (key: string | readonly unknown[]) =>
                  Array.isArray(key)
                    ? { bucket: key[0], value: "some" }
                    : { bucket: key, value: "some" },
              },
            },
            React.createElement(RouterProvider, { router }),
          ),
        ),
      );
    });
    return {
      route: () => router.state.location.pathname,
      navigate: async (mode, to) => {
        if (mode === "back") {
          historyStack.pop();
          await router.navigate(-1);
        } else {
          const nextRoute = to ?? "/login";
          historyStack.push(router.state.location.pathname);
          await router.navigate(nextRoute);
        }
      },
      cleanup: () => root.unmount(),
      // React Router surfaces *loader/action* errors on `router.state.errors`,
      // but a component that throws during *render* is caught by the route's
      // error boundary instead and never reaches that map. The default boundary
      // renders a recognizable "Unexpected Application Error!" panel, so detect
      // a render crash by inspecting the mounted DOM.
      crash: () => detectRenderCrash(context.container),
      observation: {
        history: () => [...historyStack],
        jotai: (stateName) => {
          const atom = atomByName[stateName as keyof typeof atomByName];
          return atom ? store.get(atom) : "unobservable";
        },
      },
    };
  },
  stabilize: async (_context: BenchmarkReplayContext) => {
    await Promise.resolve();
  },
});

export const renderModalityReplay = harness.renderModalityReplay;
export const observeModalityReplay = harness.observeModalityReplay;

// The React Router default error boundary renders an "Unexpected Application
// Error!" heading followed by the thrown error's message. Match it so a render
// crash anywhere in the subtree is reported as a behavioural divergence.
function detectRenderCrash(container: HTMLElement): string | undefined {
  for (const heading of container.querySelectorAll("h2")) {
    if (heading.textContent?.trim() === "Unexpected Application Error!") {
      const message = heading.nextElementSibling?.textContent?.trim();
      return message ? `render crash: ${message}` : "render crash";
    }
  }
  return undefined;
}

function registerLedgerOpsRuntimeStores(context: BenchmarkReplayContext): void {
  registerLedgerOpsSwrKeys(context);
  registerLedgerOpsLocalStateDefaults(context);
  context.zustandStores.set("useBillingStore", useBillingStore);
  context.zustandStores.set("useInvoiceStore", useInvoiceStore);
  context.zustandStores.set("usePaymentMethodStore", usePaymentMethodStore);
  context.zustandStores.set("useManagementStore", useManagementStore);
  context.zustandStores.set("useSettingsStore", useSettingsStore);
  context.zustandStores.set("useApprovalStore", useApprovalStore);
  context.zustandStores.set("useSubscriptionStore", useSubscriptionStore);
  context.zustandStores.set("useSupportStore", useSupportStore);
}

function registerLedgerOpsLocalStateDefaults(
  context: BenchmarkReplayContext,
): void {
  context.localStateDefaults.set("local:LoginForm.role", "manager");
  context.localStateDefaults.set(
    "local:LoginForm.email",
    "manager@ledger.test",
  );
  context.localStateDefaults.set("local:LoginForm.password", "ledger-pass");
  context.localStateDefaults.set(
    "local:BillingWorkbench.enqueuedInvoiceId",
    "inv-100",
  );
}

function registerLedgerOpsSwrKeys(context: BenchmarkReplayContext): void {
  const accountIds = ["acct-alpha", "acct-beta", "acct-gamma"];
  context.swrKeys.set("useAccounts", [
    "accounts-all",
    ["accounts", "active"],
    ["accounts", "suspended"],
    ["accounts", "closed"],
  ]);
  context.swrKeys.set(
    "useAccountDetail",
    accountIds.map((accountId) => ["account", accountId]),
  );
  context.swrKeys.set(
    "useDashboardSummary",
    accountIds.map((accountId) => ["dashboard", accountId]),
  );
  context.swrKeys.set("useManagementSummary", ["management-summary"]);
  context.swrKeys.set("useRiskQueue", [
    ["risk-queue", "low"],
    ["risk-queue", "medium"],
    ["risk-queue", "high"],
  ]);
  context.swrKeys.set("useRevenueQueue", ["revenue-queue"]);
  context.swrKeys.set("useOperationsQueue", ["operations-queue"]);
  context.swrKeys.set("useSettings", ["settings"]);
  context.swrKeys.set("useRoleAssignments", ["role-assignments"]);
  context.swrKeys.set(
    "useSubscription",
    accountIds.map((accountId) => ["subscription", accountId]),
  );
  context.swrKeys.set("useApprovals", ["approvals"]);
  context.swrKeys.set(
    "useBillingAccount",
    accountIds.map((accountId) => ["billing", accountId]),
  );
  context.swrKeys.set(
    "usePaymentMethods",
    accountIds.map((accountId) => ["payment-methods", accountId]),
  );
  context.swrKeys.set("useInvoiceDetail", [
    ["invoice", "inv-100"],
    ["invoice", "inv-200"],
    ["invoice", "inv-300"],
  ]);
  context.swrKeys.set(
    "useSupportCase",
    accountIds.map((accountId) => ["support", accountId]),
  );
  context.swrKeys.set("useAuditEvents", [
    ["audit", "all", "all"],
    ["audit", "login", "manager"],
    ["audit", "export", "admin"],
  ]);
}
