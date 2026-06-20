type Props = { title: string; value: string };

export function DashboardCard({ title, value }: Props) {
  return (
    <article>
      <h3>{title}</h3>
      <p>{value}</p>
    </article>
  );
}
