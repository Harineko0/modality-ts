import { z } from "zod";

export const settingsDraftSchema = z.object({
  tenantName: z.enum(["acme", "globex", "initech"]),
  billingPolicyEnabled: z.boolean(),
});

export type SettingsDraftInput = z.infer<typeof settingsDraftSchema>;
