import { z } from "zod";

export const supportEscalationSchema = z.object({
  accountId: z.enum(["acct-alpha", "acct-beta", "acct-gamma"]),
  priority: z.enum(["low", "normal", "urgent"]),
  escalationBucket: z.enum(["empty", "some", "many"]),
});

export type SupportEscalationInput = z.infer<typeof supportEscalationSchema>;
