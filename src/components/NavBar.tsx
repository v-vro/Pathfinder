import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "./Button";
import { Logo } from "./Logo";
import { DEFAULT_NAV_LINKS, type NavLink } from "./siteConfig";
import "./components.css";

export interface NavBarProps {
  links?: NavLink[];
  /** Right-hand action. Defaults to an "Open planner" button. Pass null to hide. */
  action?: ReactNode;
  /** Fade the logo in only after the page scrolls (used on the landing page, where the hero shows the logo). */
  revealBrandOnScroll?: boolean;
}

/** Sticky, translucent top bar. Collapses to a menu button below 760px. */
export function NavBar({ links = DEFAULT_NAV_LINKS, action, revealBrandOnScroll }: NavBarProps) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > window.innerHeight * 0.45);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile menu after navigation.
  const navKey = location.pathname + location.hash;
  const [lastNavKey, setLastNavKey] = useState(navKey);
  if (navKey !== lastNavKey) {
    setLastNavKey(navKey);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const brandHidden = revealBrandOnScroll && !scrolled && !open;
  const actionNode =
    action === undefined ? (
      <Button to="/planner" variant="secondary" size="sm">
        Open planner
      </Button>
    ) : (
      action
    );

  return (
    <header
      className={["pf-nav", (scrolled || open) && "pf-nav--scrolled"].filter(Boolean).join(" ")}
    >
      <a href="#main" className="pf-skip-link">
        Skip to content
      </a>
      <nav className="pf-nav__inner pf-container" aria-label="Main">
        <Link
          to="/"
          className={["pf-nav__brand", brandHidden && "pf-nav__brand--hidden"]
            .filter(Boolean)
            .join(" ")}
          aria-label="Pathfinder home"
          tabIndex={brandHidden ? -1 : undefined}
        >
          <Logo />
        </Link>

        <ul className="pf-nav__links">
          {links.map((l) => (
            <li key={l.to}>
              <Link to={l.to} className="pf-nav__link">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="pf-nav__action">{actionNode}</div>

        <button
          type="button"
          className="pf-nav__menu-btn"
          aria-expanded={open}
          aria-controls="pf-nav-mobile"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="pf-visually-hidden">{open ? "Close menu" : "Open menu"}</span>
          <span
            className={["pf-nav__burger", open && "is-open"].filter(Boolean).join(" ")}
            aria-hidden="true"
          >
            <span />
            <span />
          </span>
        </button>
      </nav>

      <div id="pf-nav-mobile" className="pf-nav__mobile" hidden={!open}>
        <ul className="pf-container">
          {links.map((l) => (
            <li key={l.to}>
              <Link to={l.to} className="pf-nav__mobile-link">
                {l.label}
              </Link>
            </li>
          ))}
          {actionNode && <li className="pf-nav__mobile-action">{actionNode}</li>}
        </ul>
      </div>
    </header>
  );
}
