import { Provider as JotaiProvider, createStore } from "jotai";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";
import { ledgerOpsRoutes } from "../shared/app-spec/routes.js";
import { createBenchmarkReplayHarness } from "../shared/testing/replay-harness.js";
import {
  auditActionFilterAtom,
  auditActorRoleFilterAtom,
  auditExportStatusAtom,
} from "./src/features/audit/state/audit-atoms.js";
import {
  accountDetailTabAtom,
  accountStatusFilterAtom,
  selectedAccountAtom,
  selectedInvoiceAtom,
} from "./src/features/accounts/state/selection-atoms.js";
import {
  loginStatusAtom,
  permissionCacheAtom,
  returnToAtom,
  roleSaveStatusAtom,
  sessionAtom,
  targetRoleAtom,
} from "./src/features/auth/state/session-atoms.js";
import {
  managementFilterAtom,
  managementTabAtom,
} from "./src/features/management/state/management-atoms.js";

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
    let currentRoute = context.initialRoute;
    let setReplayRoute: ((route: string) => void) | undefined;
    const store = createStore();
    const root = createRoot(context.container);
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
    return {
      route: () => currentRoute,
      navigate: async (mode, to) => {
        currentRoute = mode === "back" ? "/login" : (to ?? "/login");
        setReplayRoute?.(currentRoute);
      },
      cleanup: () => root.unmount(),
      observation: {
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
