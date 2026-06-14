import { NavLink } from "react-router";

const TABS: [string, string][] = [
  ["/", "Overview"],
  ["/orders", "Orders"],
  ["/products", "Products"],
  ["/pay", "Payment Link"],
  ["/notes", "Notes"],
];

export function Nav() {
  return (
    <nav className="bv-tabs">
      {TABS.map(([to, label]) => (
        <NavLink key={to} to={to} end={to === "/"} className="bv-tab">
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
