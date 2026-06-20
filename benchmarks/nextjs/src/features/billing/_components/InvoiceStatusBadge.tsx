import type { InvoiceStatus } from "../../../../shared/features/fixtures/domain/fixtures.js";

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <span>{status}</span>;
}
