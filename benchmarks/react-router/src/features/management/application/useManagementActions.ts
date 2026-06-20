import { useSetAtom } from "jotai";
import { managementTabAtom } from "../state/management-atoms.js";
import type { ManagementTab } from "../../../../shared/features/management/domain/dashboard.js";

export function useManagementActions() {
  const setTab = useSetAtom(managementTabAtom);
  return { setTab: (tab: ManagementTab) => setTab(tab) };
}
