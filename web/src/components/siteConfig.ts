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

export const TEAM = ["Eric Fu", "Ibrahim Farrukh", "Shourya Walia"];

/** Demo video shown in the landing page's Demo section. */
export const DEMO_VIDEO = {
  /** Public YouTube page, for linking out. */
  watchUrl: "https://www.youtube.com/watch?v=aN22kHUJo7c",
  /** Privacy-enhanced embed URL used by the on-page player. */
  embedUrl: "https://www.youtube-nocookie.com/embed/aN22kHUJo7c",
};
