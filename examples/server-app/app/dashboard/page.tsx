import { saveDashboard } from "../actions";

export async function getServerSideProps() {
  const session = await getServerSession();
  if (!session) return { props: { secret: null } };
  return { props: { secret: "server-data" } };
}

async function getServerSession(): Promise<{ user: string } | null> {
  return null;
}

export default function DashboardPage() {
  return (
    <form action={saveDashboard}>
      <button type="submit">Save</button>
    </form>
  );
}
