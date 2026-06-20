"use client";

import type { ReactNode } from "react";
import { Provider as JotaiProvider } from "jotai";
import { SWRConfig } from "swr";
import { AppShell } from "./shell/AppShell.js";

const fetcher = async (key: string | readonly unknown[]) => {
  if (Array.isArray(key)) {
    return { bucket: key[0], value: "some" };
  }
  return { bucket: key, value: "some" };
};

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <JotaiProvider>
      <SWRConfig
        value={{ fetcher, dedupingInterval: 0, provider: () => new Map() }}
      >
        <AppShell>{children}</AppShell>
      </SWRConfig>
    </JotaiProvider>
  );
}
