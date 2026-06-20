import { z } from "zod";

export const loginFormSchema = z.object({
  role: z.enum(["guest", "analyst", "manager", "admin"]),
  email: z.string().email(),
  password: z.string().min(8),
});

export type LoginFormInput = z.infer<typeof loginFormSchema>;

export const roleAssignmentSchema = z.object({
  userId: z.enum(["user-a", "user-b", "user-c"]),
  targetRole: z.enum(["guest", "analyst", "manager", "admin"]),
});

export type RoleAssignmentInput = z.infer<typeof roleAssignmentSchema>;
