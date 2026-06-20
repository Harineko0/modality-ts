export {
  login,
  refreshSession,
  saveRoleAssignment,
} from "../../../../shared/features/auth/infra/fake-auth-provider.js";
export { loadDashboardSummary } from "../../dashboard/infra/dashboard-queries.js";
export { loadAccount } from "../../accounts/infra/account-queries.js";
export {
  loadManagementSummary,
  bulkSuspendAccounts,
} from "../../management/infra/management-queries.js";
export {
  requestApproval,
  applyApproval,
} from "../../subscription/infra/subscription-queries.js";
export {
  createPaymentIntent,
  capturePayment,
  retryInvoice,
  savePaymentMethod,
} from "../../billing/infra/api.js";
export { openSupportEscalation } from "../../support/infra/support-queries.js";
export { exportAudit } from "../../audit/infra/audit-queries.js";
export { saveSettings } from "../../settings/infra/settings-queries.js";

import {
  login,
  refreshSession,
  saveRoleAssignment,
} from "../../../../shared/features/auth/infra/fake-auth-provider.js";
import { loadDashboardSummary } from "../../dashboard/infra/dashboard-queries.js";
import { loadAccount } from "../../accounts/infra/account-queries.js";
import {
  loadManagementSummary,
  bulkSuspendAccounts,
} from "../../management/infra/management-queries.js";
import {
  requestApproval,
  applyApproval,
} from "../../subscription/infra/subscription-queries.js";
import {
  createPaymentIntent,
  capturePayment,
  retryInvoice,
  savePaymentMethod,
} from "../../billing/infra/api.js";
import { openSupportEscalation } from "../../support/infra/support-queries.js";
import { exportAudit } from "../../audit/infra/audit-queries.js";
import { saveSettings } from "../../settings/infra/settings-queries.js";

export const api = {
  login,
  refreshSession,
  loadDashboardSummary,
  loadAccount,
  loadManagementSummary,
  bulkSuspendAccounts,
  requestApproval,
  applyApproval,
  createPaymentIntent,
  capturePayment,
  retryInvoice,
  savePaymentMethod,
  openSupportEscalation,
  exportAudit,
  saveSettings,
  saveRoleAssignment,
};
