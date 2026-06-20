type Props = { status: string; onCreate: () => void; onCapture: () => void };

export function PaymentIntentPanel({ status, onCreate, onCapture }: Props) {
  return (
    <div>
      <p>payment intent status: {status}</p>
      <button type="button" onClick={onCreate}>
        create payment intent button
      </button>
      <button type="button" onClick={onCapture}>
        capture payment button
      </button>
    </div>
  );
}
