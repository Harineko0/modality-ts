"use server";

import { revalidatePath } from "next/cache";

export async function saveDashboard() {
  revalidatePath("/dashboard");
}
