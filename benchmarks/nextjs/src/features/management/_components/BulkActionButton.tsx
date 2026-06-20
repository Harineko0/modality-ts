type Props = { label: string; disabled?: boolean; onClick: () => void };

export function BulkActionButton({ label, disabled, onClick }: Props) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}
