import type { AccountStatus } from "../../../../shared/features/fixtures/domain/fixtures.js";

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  return <span>{status}</span>;
}
