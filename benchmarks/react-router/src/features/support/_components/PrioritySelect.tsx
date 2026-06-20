import type { SupportPriority } from "../../../../shared/features/support/domain/escalation.js";

const priorities: SupportPriority[] = ["low", "normal", "urgent"];

type Props = {
  value: SupportPriority;
  onChange: (value: SupportPriority) => void;
};

export function PrioritySelect({ value, onChange }: Props) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as SupportPriority)}
    >
      {priorities.map((priority) => (
        <option key={priority} value={priority}>
          {priority}
        </option>
      ))}
    </select>
  );
}
