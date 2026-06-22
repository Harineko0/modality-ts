import { useSetAtom } from "jotai";
import type { ManagementTab } from "../../../../shared/features/management/domain/dashboard.js";
import { managementTabAtom } from "../state/management-atoms.js";

export function useManagementActions() {
  const setTab = useSetAtom(managementTabAtom);
  return { setTab: (tab: ManagementTab) => setTab(tab) };
}
