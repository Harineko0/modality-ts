import { createFileRoute, redirect } from "@tanstack/react-router";
import { fetchDashboard } from "../server/dashboard.server";

export const Route = createFileRoute("/dashboard")({
  loader: () => fetchDashboard(),
  beforeLoad: () => {
    throw redirect({ to: "/login" });
  },
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <button type="button" onClick={() => {}}>
      refresh
    </button>
  );
}
