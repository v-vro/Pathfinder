/* Small line icons for the landing page. Stroke uses currentColor. */

import type { SVGProps } from "react";

const base: SVGProps<SVGSVGElement> = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export const IconArrowRight = () => (
  <svg {...base}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const IconPlay = () => (
  <svg {...base}>
    <path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none" />
  </svg>
);

/** Head in front of a framed window. */
export const IconHeadWindow = () => (
  <svg {...base}>
    <rect x="3" y="4" width="18" height="13" rx="2" />
    <path d="M8 21h8" />
    <circle cx="12" cy="9.5" r="2.2" />
    <path d="M8.5 15c.6-1.6 2-2.5 3.5-2.5s2.9.9 3.5 2.5" />
  </svg>
);

/** Pinching hand aiming a needle. */
export const IconHandNeedle = () => (
  <svg {...base}>
    <path d="M14 3l7 7" />
    <path d="M17.5 6.5L9 15" />
    <path d="M9 15l-1.5 1.5" />
    <path d="M4 20c0-2.5 1.2-3.8 3-4.5l2 2c-.7 1.8-2 3-4.5 3" />
  </svg>
);

/** Grid with a highlighted safe window. */
export const IconSkinMap = () => (
  <svg {...base}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" opacity="0.5" />
    <rect x="9" y="9" width="6" height="6" fill="currentColor" stroke="none" />
  </svg>
);

/** Stacked CT slices. */
export const IconSlice = () => (
  <svg {...base}>
    <path d="M12 3l9 4.5-9 4.5-9-4.5z" />
    <path d="M3 12l9 4.5 9-4.5" />
    <path d="M3 16.5L12 21l9-4.5" />
  </svg>
);

/** Route to a target. */
export const IconPath = () => (
  <svg {...base}>
    <circle cx="5" cy="6" r="2" />
    <path d="M7 6h5a3 3 0 010 6H9a3 3 0 000 6h7" />
    <circle cx="19" cy="18" r="2.2" fill="currentColor" stroke="none" />
  </svg>
);

/** Clipboard plus speech bubble. */
export const IconExplain = () => (
  <svg {...base}>
    <rect x="3" y="3" width="11" height="15" rx="2" />
    <path d="M6 7h5M6 10.5h5M6 14h3" />
    <path d="M14 13h6a1 1 0 011 1v4a1 1 0 01-1 1h-2l-2 2v-2h-2a1 1 0 01-1-1v-4" />
  </svg>
);
