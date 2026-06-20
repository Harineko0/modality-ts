import type { Plan } from "../../../../shared/features/fixtures/domain/fixtures.js";

const plans: Plan[] = ["starter", "growth", "enterprise"];

type Props = { value: Plan; onChange: (plan: Plan) => void };

export function PlanSelector({ value, onChange }: Props) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as Plan)}
    >
      {plans.map((plan) => (
        <option key={plan} value={plan}>
          {plan}
        </option>
      ))}
    </select>
  );
}
