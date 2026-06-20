type Props = { status: string; onSave: () => void };

export function SettingsSaveBar({ status, onSave }: Props) {
  return (
    <div>
      <button type="button" onClick={onSave}>
        save settings button
      </button>
      <span>settings save status: {status}</span>
    </div>
  );
}
