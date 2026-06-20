import { atom } from "jotai";
import type { ManagementTab } from "../../../../shared/features/management/domain/dashboard.js";

export const managementTabAtom = atom<ManagementTab>("overview");
export const managementFilterAtom = atom<"all" | "risk" | "revenue">("all");
