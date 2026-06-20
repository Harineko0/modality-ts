import type { Role } from "../../../../shared/features/fixtures/domain/fixtures.js";

export function RoleBadge({ role }: { role: Role }) {
  return <span>{role}</span>;
}
