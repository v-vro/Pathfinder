import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Footer } from "./Footer";
import { NavBar } from "./NavBar";
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
  return (
    <div className="pf-layout">
      <ScrollManager />
      <NavBar />
      <main id="main" className="pf-layout__main" tabIndex={-1}>
        <Outlet />
      </main>
      {!hideFooter && <Footer />}
    </div>
  );
}
