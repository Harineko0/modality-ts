type Props = { label: string; tone: "info" | "warn" | "success" };

export function StatusBadge({ label, tone }: Props) {
  return <span data-tone={tone}>{label}</span>;
}
