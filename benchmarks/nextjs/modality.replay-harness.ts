import { createStore, Provider as JotaiProvider } from "jotai";
import React, { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";
import { ledgerOpsRoutes } from "../shared/app-spec/routes.js";
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

function ReplayNextClient({
  route,
  onNavigate,
}: {
  route: string;
  onNavigate(route: string): void;
}) {
  return React.createElement(
    "div",
    null,
    React.createElement(
      "nav",
      null,
      ledgerOpsRoutes.map((entry) =>
        React.createElement(
          "button",
          {
            key: entry,
            type: "button",
            onClick: () => onNavigate(entry),
          },
          entry,
        ),
      ),
    ),
    React.createElement("main", { "data-modality-var": "sys:route" }, route),
  );
}

function ReplayNextRoot({
  initialRoute,
  onRoute,
  bindRouteSetter,
}: {
  initialRoute: string;
  onRoute(route: string): void;
  bindRouteSetter(setRoute: (route: string) => void): void;
}) {
  const [route, setRoute] = useState(initialRoute);
  useEffect(() => {
    bindRouteSetter(setRoute);
  }, [bindRouteSetter]);
  return React.createElement(ReplayNextClient, {
    route,
    onNavigate: (nextRoute) => {
      setRoute(nextRoute);
      onRoute(nextRoute);
    },
  });
}

const harness = createBenchmarkReplayHarness({
  initialRoute: "/login",
  mount(context) {
    registerLedgerOpsRuntimeStores(context);
    let currentRoute = context.initialRoute;
    const historyStack: string[] = [];
    let setReplayRoute: ((route: string) => void) | undefined;
    const store = createStore();
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
            React.createElement(ReplayNextRoot, {
              initialRoute: context.initialRoute,
              onRoute: (route) => {
                currentRoute = route;
              },
              bindRouteSetter: (setRoute) => {
                setReplayRoute = setRoute;
              },
            }),
          ),
        ),
      );
    });
    return {
      route: () => currentRoute,
      navigate: async (mode, to) => {
        if (mode === "back") {
          currentRoute = historyStack.pop() ?? "/login";
        } else {
          historyStack.push(currentRoute);
          currentRoute = to ?? "/login";
        }
        setReplayRoute?.(currentRoute);
      },
      cleanup: () => root.unmount(),
      observation: {
        history: () => [...historyStack],
        system: (varId) => readNextSystemVar(varId, currentRoute),
        jotai: (stateName) => {
          const atom = atomByName[stateName as keyof typeof atomByName];
          return atom ? store.get(atom) : "unobservable";
        },
      },
    };
  },
});

export const renderModalityReplay = harness.renderModalityReplay;
export const observeModalityReplay = harness.observeModalityReplay;

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

function readNextSystemVar(
  varId: string,
  currentRoute: string,
): string | "unobservable" {
  if (varId.startsWith("sys:next:cache:path:")) return "empty";
  if (varId === "sys:next:slot:children") return pageSlotForRoute(currentRoute);
  return "unobservable";
}

function pageSlotForRoute(route: string): string {
  if (route.startsWith("/accounts/") && route.endsWith("/billing")) {
    return "app:app/accounts/[accountId]/billing:page";
  }
  if (route.startsWith("/accounts/") && route.includes("/invoices/")) {
    return "app:app/accounts/[accountId]/invoices/[invoiceId]:page";
  }
  if (route.startsWith("/accounts/") && route.endsWith("/payment-methods")) {
    return "app:app/accounts/[accountId]/payment-methods:page";
  }
  if (route.startsWith("/accounts/") && route.endsWith("/subscription")) {
    return "app:app/accounts/[accountId]/subscription:page";
  }
  if (route.startsWith("/accounts/") && route.endsWith("/support")) {
    return "app:app/accounts/[accountId]/support:page";
  }
  if (route.startsWith("/accounts/")) {
    return "app:app/accounts/[accountId]:page";
  }
  const normalized = route === "/" ? "" : route;
  return `app:app${normalized}:page`;
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
