import type { ApprovalStatus } from "../../../../shared/features/fixtures/domain/fixtures.js";

export function ApprovalBanner({ status }: { status: ApprovalStatus }) {
  return <div>approval banner: {status}</div>;
}
