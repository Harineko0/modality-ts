import type { AccountId } from "../../../../shared/features/accounts/domain/account.js";

type Props = {
  label: string;
  value: AccountId;
  onChange: (value: AccountId) => void;
};

const options: AccountId[] = ["acct-alpha", "acct-beta", "acct-gamma"];

export function AccountBucketSelect({ label, value, onChange }: Props) {
  return (
    <label>
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as AccountId)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
