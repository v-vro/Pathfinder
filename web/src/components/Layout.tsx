import { useEffect, useLayoutEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Footer } from "./Footer";
import { NavBar } from "./NavBar";
import "../theme.css";
import "./components.css";

/** Scrolls to #hash targets after navigation, or to the top on a new page. */
function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) {
        el.scrollIntoView();
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

export interface LayoutProps {
  /** Hide the footer, e.g. for a full-screen tool. */
  hideFooter?: boolean;
}

/** Shared page shell: navbar, <main id="main">, footer. Used as a route element. */
export function Layout({ hideFooter }: LayoutProps) {
  const { pathname } = useLocation();

  // Turn on the site's page-wide styles (see theme.css) only while a site page is shown.
  useLayoutEffect(() => {
    document.documentElement.classList.add("pf-site");
    return () => document.documentElement.classList.remove("pf-site");
  }, []);

  return (
    <div className="pf-layout">
      <ScrollManager />
      <NavBar revealBrandOnScroll={pathname === "/"} />
      <main id="main" className="pf-layout__main" tabIndex={-1}>
        <Outlet />
      </main>
      {!hideFooter && <Footer />}
    </div>
  );
}
