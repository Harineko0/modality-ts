"use client";

import type { ReactNode } from "react";
import { NavMenu } from "./NavMenu.js";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div>
      <NavMenu />
      <main>{children}</main>
    </div>
  );
}
