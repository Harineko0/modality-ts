import { Outlet } from "react-router-dom";
import { NavMenu } from "./NavMenu.js";

export function AppShell() {
  return (
    <div>
      <NavMenu />
      <main>
        <Outlet />
      </main>
    </div>
  );
}
