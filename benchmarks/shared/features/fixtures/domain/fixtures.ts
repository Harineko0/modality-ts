import type { Account, AccountId } from "../../accounts/domain/account.js";
import type { Invoice } from "../../billing/domain/invoice.js";
import type { ManagementSummary } from "../../management/domain/dashboard.js";
import type { ApprovalRequest } from "../../subscription/domain/approval.js";
import type { SupportCase } from "../../support/domain/escalation.js";
import type { AuditEvent } from "../../audit/domain/audit.js";
import type { TenantSettings } from "../../settings/domain/settings.js";
import type { Session } from "../../auth/domain/session.js";

export type Role = "guest" | "analyst" | "manager" | "admin";
export type Permission =
  | "view_dashboard"
  | "view_accounts"
  | "manage_subscription"
  | "manage_billing"
  | "manage_payment_methods"
  | "approve_changes"
  | "view_audit"
  | "export_audit"
  | "manage_settings"
  | "manage_rbac"
  | "use_management_dashboard"
  | "bulk_suspend_accounts";
export type AccountStatus = "trial" | "active" | "past_due" | "suspended";
export type Plan = "starter" | "growth" | "enterprise";
export type InvoiceStatus = "draft" | "open" | "paid" | "void" | "disputed";
export type PaymentMethodStatus =
  | "missing"
  | "valid"
  | "expired"
  | "requires_action";
export type ApprovalStatus = "none" | "requested" | "approved" | "rejected";
export type QueueBucket = "empty" | "some" | "many";
export type RiskBucket = "low" | "medium" | "high";
export type RevenueHealth = "healthy" | "watch" | "critical";
export type AsyncStatus =
  | "idle"
  | "loading"
  | "submitting"
  | "success"
  | "error";

export const allPermissions = [
  "view_dashboard",
  "view_accounts",
  "manage_subscription",
  "manage_billing",
  "manage_payment_methods",
  "approve_changes",
  "view_audit",
  "export_audit",
  "manage_settings",
  "manage_rbac",
  "use_management_dashboard",
  "bulk_suspend_accounts",
] as const satisfies readonly Permission[];

export const seedAccounts: readonly Account[] = [
  {
    id: "acct-alpha",
    name: "Alpha Labs",
    status: "active",
    plan: "growth",
    seatCount: 12,
  },
  {
    id: "acct-beta",
    name: "Beta Works",
    status: "past_due",
    plan: "starter",
    seatCount: 4,
  },
  {
    id: "acct-gamma",
    name: "Gamma Ops",
    status: "suspended",
    plan: "enterprise",
    seatCount: 80,
  },
];

export const seedInvoices: readonly Invoice[] = [
  {
    id: "inv-100",
    accountId: "acct-alpha",
    status: "open",
    amountBucket: "small",
    retryCount: 0,
  },
  {
    id: "inv-200",
    accountId: "acct-beta",
    status: "paid",
    amountBucket: "medium",
    retryCount: 1,
  },
  {
    id: "inv-300",
    accountId: "acct-gamma",
    status: "disputed",
    amountBucket: "large",
    retryCount: 2,
  },
];

export const seedManagementSummary: ManagementSummary = {
  riskBucket: "medium",
  revenueHealth: "watch",
  approvalQueue: "some",
  supportBreachQueue: "some",
};

export const seedApprovalRequests: readonly ApprovalRequest[] = [
  {
    accountId: "acct-alpha",
    requestedPlan: "enterprise",
    requestedSeats: 40,
    status: "requested",
  },
];

export const seedSupportCases: readonly SupportCase[] = [
  {
    accountId: "acct-beta",
    priority: "urgent",
    escalationBucket: "some",
    owner: "unassigned",
  },
];

export const seedAuditEvents: readonly AuditEvent[] = [
  {
    id: "evt-1",
    action: "login",
    actorRole: "manager",
    permissionRequired: null,
  },
  {
    id: "evt-2",
    action: "support_escalation",
    actorRole: "analyst",
    permissionRequired: "view_accounts",
  },
];

export const seedSettings: TenantSettings = {
  tenantName: "acme",
  billingPolicyEnabled: true,
};

export const seedSessions: Record<Exclude<Role, "guest">, Session> = {
  analyst: { userId: "user-a", email: "analyst@ledger.test", role: "analyst" },
  manager: { userId: "user-b", email: "manager@ledger.test", role: "manager" },
  admin: { userId: "user-c", email: "admin@ledger.test", role: "admin" },
};

export function accountsByStatus(status: AccountStatus): readonly Account[] {
  return seedAccounts.filter((account) => account.status === status);
}

export function accountById(accountId: AccountId): Account | undefined {
  return seedAccounts.find((account) => account.id === accountId);
}

export function invoiceById(invoiceId: Invoice["id"]): Invoice | undefined {
  return seedInvoices.find((invoice) => invoice.id === invoiceId);
}

export function bucketCount(bucket: QueueBucket): number {
  switch (bucket) {
    case "empty":
      return 0;
    case "some":
      return 2;
    case "many":
      return 5;
  }
}
