import { Provider as JotaiProvider, createStore } from "jotai";
import React from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { SWRConfig } from "swr";
import {
  createBenchmarkReplayHarness,
  type BenchmarkReplayContext,
} from "../shared/testing/replay-harness.js";
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
import { routes } from "./src/app/router.js";

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
  mount(context) {
    const store = createStore();
    const router = createMemoryRouter(routes, {
      initialEntries: [context.initialRoute],
    });
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
          React.createElement(RouterProvider, { router }),
        ),
      ),
    );
    return {
      route: () => router.state.location.pathname,
      navigate: async (mode, to) => {
        if (mode === "back") await router.navigate(-1);
        else await router.navigate(to ?? "/login");
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
  stabilize: async (_context: BenchmarkReplayContext) => {
    await Promise.resolve();
  },
});

export const renderModalityReplay = harness.renderModalityReplay;
export const observeModalityReplay = harness.observeModalityReplay;
