import { Link } from "react-router-dom";
import { Logo } from "./Logo";
import { TEAM } from "./siteConfig";
import "./components.css";

export function Footer() {
  return (
    <footer className="pf-footer">
      <div className="pf-container pf-footer__inner">
        <div className="pf-footer__brand">
          <Link to="/" aria-label="Pathfinder home">
            <Logo height={22} />
          </Link>
          <p className="pf-footer__disclaimer">
            Decision support for planning and education. Not a medical device and not medical
            advice.
          </p>
        </div>

        <div className="pf-footer__meta">
          <p className="pf-mono pf-muted">Built at Hack Western 13</p>
          <p className="pf-footer__team">{TEAM.join(" · ")}</p>
          <p className="pf-footer__credits pf-muted">
            CT data: LIDC-IDRI via{" "}
            <a
              href="https://www.cancerimagingarchive.net/collection/lidc-idri/"
              target="_blank"
              rel="noreferrer"
            >
              The Cancer Imaging Archive
            </a>
            , licensed{" "}
            <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">
              CC BY 3.0
            </a>
            .
          </p>
        </div>
      </div>
    </footer>
  );
}
