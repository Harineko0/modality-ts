import { useSupportStore } from "../state/support-store.js";

export function useSupportActions() {
  const setPriority = useSupportStore((state) => state.setPriority);
  const openEscalation = useSupportStore((state) => state.openEscalation);
  const assignOwner = useSupportStore((state) => state.assignOwner);
  return { setPriority, openEscalation, assignOwner };
}
