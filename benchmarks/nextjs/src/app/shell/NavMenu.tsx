"use client";

import Link from "next/link";

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
      {links.map(([href, label]) => (
        <Link key={href} href={href}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
