/** Site-wide content shared by NavBar and Footer. Edit here, not in the components. */

export interface NavLink {
  label: string;
  /** Route or route+hash, e.g. "/planner" or "/#features". */
  to: string;
}

export const DEFAULT_NAV_LINKS: NavLink[] = [
  { label: "Problem", to: "/#problem" },
  { label: "How it works", to: "/#how-it-works" },
  { label: "Features", to: "/#features" },
  { label: "Demo", to: "/#demo" },
];

// TODO: replace with the real team names.
export const TEAM = ["Team member 1", "Team member 2", "Team member 3", "Team member 4"];
