import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Root,
});

function Root() {
  return <Outlet />;
}
