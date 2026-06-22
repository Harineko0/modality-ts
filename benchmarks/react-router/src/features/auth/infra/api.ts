export {
  login,
  refreshSession,
  saveRoleAssignment,
} from "../../../../shared/features/auth/infra/fake-auth-provider.js";
export { loadAccount } from "../../accounts/infra/account-queries.js";
export { exportAudit } from "../../audit/infra/audit-queries.js";
export {
  capturePayment,
  createPaymentIntent,
  retryInvoice,
  savePaymentMethod,
} from "../../billing/infra/api.js";
export { loadDashboardSummary } from "../../dashboard/infra/dashboard-queries.js";
export {
  bulkSuspendAccounts,
  loadManagementSummary,
} from "../../management/infra/management-queries.js";
export { saveSettings } from "../../settings/infra/settings-queries.js";
export {
  applyApproval,
  requestApproval,
} from "../../subscription/infra/subscription-queries.js";
export { openSupportEscalation } from "../../support/infra/support-queries.js";

import {
  login,
  refreshSession,
  saveRoleAssignment,
} from "../../../../shared/features/auth/infra/fake-auth-provider.js";
import { loadAccount } from "../../accounts/infra/account-queries.js";
import { exportAudit } from "../../audit/infra/audit-queries.js";
import {
  capturePayment,
  createPaymentIntent,
  retryInvoice,
  savePaymentMethod,
} from "../../billing/infra/api.js";
import { loadDashboardSummary } from "../../dashboard/infra/dashboard-queries.js";
import {
  bulkSuspendAccounts,
  loadManagementSummary,
} from "../../management/infra/management-queries.js";
import { saveSettings } from "../../settings/infra/settings-queries.js";
import {
  applyApproval,
  requestApproval,
} from "../../subscription/infra/subscription-queries.js";
import { openSupportEscalation } from "../../support/infra/support-queries.js";

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
