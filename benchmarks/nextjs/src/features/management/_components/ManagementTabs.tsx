import type { ManagementTab } from "../../../../shared/features/management/domain/dashboard.js";

const tabs: ManagementTab[] = ["overview", "risk", "revenue", "operations"];

type Props = { value: ManagementTab; onChange: (tab: ManagementTab) => void };

export function ManagementTabs({ value, onChange }: Props) {
  return (
    <div role="tablist" aria-label="management tab list">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={value === tab}
          onClick={() => onChange(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
