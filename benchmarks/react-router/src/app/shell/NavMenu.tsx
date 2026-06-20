import { Link } from "react-router-dom";

const links = [
  ["/login", "Login"],
  ["/dashboard", "Dashboard"],
  ["/management", "Management"],
  ["/accounts", "Accounts"],
  ["/approvals", "Approvals"],
  ["/audit", "Audit"],
  ["/settings", "Settings"],
] as const;

export function NavMenu() {
  return (
    <nav>
      {links.map(([to, label]) => (
        <Link key={to} to={to}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
