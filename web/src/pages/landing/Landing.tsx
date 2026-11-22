import { useCallback, useState, type ReactNode } from "react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DitherCanvas, type DitherSceneSetup } from "../../components/DitherCanvas";
import { Panel } from "../../components/Panel";
import { Reveal } from "../../components/Reveal";
import { SectionHeader } from "../../components/SectionHeader";
import { HeroAnatomy } from "./HeroAnatomy";
import {
  IconArrowRight,
  IconDrag,
  IconExplain,
  IconHandNeedle,
  IconHeadWindow,
  IconMouse,
  IconPath,
  IconPlay,
  IconSkinMap,
  IconSlice,
} from "./icons";
import { needleCardScene } from "./scenes/anatomy";
import { pathScene, scanScene } from "./scenes/steps";
import "./landing.css";

/** Set to a video URL (e.g. "/demo.mp4" in public/) when the demo is recorded. */
const DEMO_VIDEO_URL = "";

export default function Landing() {
  return (
    <>
      <Hero />
      <Problem />
      <HowItWorks />
      <Features />
      <Demo />
      <BuiltWith />
    </>
  );
}

/* ---------------- Hero ---------------- */

function Hero() {
  const [hintVisible, setHintVisible] = useState(true);
  const [canHover] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches,
  );
  const hideHint = useCallback(() => setHintVisible(false), []);

  return (
    <section className="lp-hero" aria-labelledby="hero-title">
      <HeroAnatomy className="lp-hero__canvas" onFirstInteraction={hideHint} />

      <div className="lp-hero__inner">
        <div className="lp-hero__copy">
          <img
            src="/pathfinder-logo-white-transparent.svg"
            alt="Pathfinder"
            className="lp-hero__logo"
            width={698}
            height={165}
          />
          <h1 id="hero-title" className="lp-hero__title">
            Find the safest path to the spot that&nbsp;matters.
          </h1>
          <p className="lp-hero__sub">Turn a chest CT into 3D and plan the safest biopsy route.</p>
          <div className="lp-hero__actions">
            <Button href="/planner" variant="primary" iconEnd={<IconArrowRight />}>
              Try the planner
            </Button>
            <Button to="/#demo" variant="secondary" iconStart={<IconPlay />}>
              Watch the demo
            </Button>
          </div>
        </div>
      </div>

      <p className="lp-hero__note pf-mono">Stylised model · example risks</p>
      <p
        className={["lp-hero__hint pf-mono", !hintVisible && "is-hidden"].filter(Boolean).join(" ")}
        aria-hidden="true"
      >
        {canHover ? <IconMouse /> : <IconDrag />}
        {canHover ? "Move your mouse to look around · drag to spin" : "Drag to look around"}
      </p>
    </section>
  );
}

/* ---------------- Problem ---------------- */

function Problem() {
  // 20 people: 4 is "1 in 5", 9 is "nearly 1 in 2".
  const people = Array.from({ length: 20 }, (_, i) => (i < 4 ? "low" : i < 9 ? "high" : "none"));
  return (
    <section id="problem" className="lp-section" aria-labelledby="problem-title">
      <div className="pf-container lp-problem">
        <Reveal className="lp-problem__stat">
          <p className="pf-mono lp-eyebrow">01 / The problem</p>
          <h2 id="problem-title" className="lp-stat">
            <span className="lp-stat__num">1 in 5</span>{" "}
            <span className="lp-stat__join">to nearly</span>{" "}
            <span className="lp-stat__num">1 in 2</span>
          </h2>
          <p className="lp-stat__caption">
            patients get a collapsed lung (pneumothorax) after a CT-guided lung biopsy, its most
            common complication.
          </p>
          <div className="lp-people" aria-hidden="true">
            {people.map((p, i) => (
              <span key={i} className={`lp-person lp-person--${p}`} />
            ))}
          </div>
          <p className="lp-people__legend pf-mono pf-muted" aria-hidden="true">
            <span>
              <i className="lp-person lp-person--low" /> 1 in 5
            </span>
            <span>
              <i className="lp-person lp-person--high" /> nearly 1 in 2
            </span>
          </p>
          <p className="lp-source pf-muted">
            Rates vary by study. Sources: Heerink et al., <cite>Eur Radiol</cite> 2017; Boskovic et
            al., <cite>J Thorac Dis</cite> 2014.
          </p>
        </Reveal>

        <Reveal className="lp-problem__why" delay={120}>
          <Panel padding="lg" className="lp-why">
            <h3 className="lp-why__title">Why the route matters</h3>
            <p>The route sets how much lung the needle crosses and at what angle.</p>
            <p>Both predict a collapsed lung. Doctors can choose the route.</p>
            <ul className="lp-why__factors" aria-label="Route risk factors">
              {["Lung crossed", "Pleural angle", "Fissures", "Emphysema", "Vessels"].map((f) => (
                <li key={f}>
                  <Badge>{f}</Badge>
                </li>
              ))}
            </ul>
          </Panel>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- How it works ---------------- */

const STEPS: { title: string; body: string; scene: DitherSceneSetup; alt: string }[] = [
  {
    title: "Scan to 3D body",
    body: "Pathfinder rebuilds the ribs, lungs, vessels and lesion from a chest CT in 3D.",
    scene: scanScene,
    alt: "CT slices stack up into two lungs as a scan plane sweeps upward.",
  },
  {
    title: "Aim and see the risk",
    body: "Point the needle. Pathfinder scores the route as you move and shows what makes it risky: lung crossed, angle, fissures, damaged tissue, vessels.",
    scene: needleCardScene,
    alt: "A blue needle tries routes to a target. Each track turns green, yellow or red, with a label.",
  },
  {
    title: "Safest path, explained",
    body: "One click finds the lowest-risk route. Gemini explains it to the doctor and the patient.",
    scene: pathScene,
    alt: "Routes to a target light up one at a time until the safest one stays lit.",
  },
];

function HowItWorks() {
  return (
    <section id="how-it-works" className="lp-section lp-section--tint" aria-labelledby="how-title">
      <div className="pf-container">
        <Reveal>
          <SectionHeader
            id="how-title"
            eyebrow="02 / How it works"
            title="From scan to safest path"
          />
        </Reveal>
        <ol className="lp-steps">
          {STEPS.map((s, i) => (
            <Reveal as="li" key={s.title} delay={i * 110} className="lp-step">
              <Panel padding="none" className="lp-step__panel">
                <DitherCanvas
                  setup={s.scene}
                  pixelSize={2.5}
                  className="lp-step__art"
                  label={s.alt}
                />
                <div className="lp-step__body">
                  <p className="pf-mono lp-step__num">Step {String(i + 1).padStart(2, "0")}</p>
                  <h3 className="lp-step__title">{s.title}</h3>
                  <p className="pf-muted">{s.body}</p>
                </div>
              </Panel>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------------- Features ---------------- */

const FEATURES: { icon: ReactNode; title: string; body: string; tag?: string }[] = [
  {
    icon: <IconHeadWindow />,
    title: "Head-tracked 3D window",
    body: "The view follows your head, like a window into the chest.",
    tag: "MediaPipe",
  },
  {
    icon: <IconHandNeedle />,
    title: "Hand-aimed needle",
    body: "Pinch in the air to aim the needle.",
    tag: "MediaPipe",
  },
  {
    icon: <IconSkinMap />,
    title: "Safe-zone skin map",
    body: "Safe gaps between the ribs show up on the skin.",
  },
  {
    icon: <IconSlice />,
    title: "Live CT slice",
    body: "The real CT slice follows the needle as you aim.",
  },
  {
    icon: <IconPath />,
    title: "One-click safest path",
    body: "Pathfinder ranks every route and shows the numbers.",
  },
  {
    icon: <IconExplain />,
    title: "Doctor plan and patient explanation",
    body: "Gemini writes a plan for the doctor and a summary for the patient.",
    tag: "Gemini",
  },
];

function Features() {
  return (
    <section id="features" className="lp-section" aria-labelledby="features-title">
      <div className="pf-container">
        <Reveal>
          <SectionHeader
            id="features-title"
            eyebrow="03 / Features"
            title="What's in the planner"
            description="Compare routes, then explain the one you pick."
          />
        </Reveal>
        <ul className="lp-features">
          {FEATURES.map((f, i) => (
            <Reveal as="li" key={f.title} delay={(i % 3) * 90}>
              <Panel padding="lg" className="lp-feature">
                <div className="lp-feature__head">
                  <span className="lp-feature__icon">{f.icon}</span>
                  {f.tag && (
                    <Badge tone={f.tag === "Gemini" ? "primary" : "neutral"}>{f.tag}</Badge>
                  )}
                </div>
                <h3 className="lp-feature__title">{f.title}</h3>
                <p className="pf-muted">{f.body}</p>
              </Panel>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------------- Demo ---------------- */

function Demo() {
  const [playing, setPlaying] = useState(false);
  const hasVideo = DEMO_VIDEO_URL !== "";
  return (
    <section id="demo" className="lp-section lp-section--tint" aria-labelledby="demo-title">
      <div className="pf-container">
        <Reveal>
          <SectionHeader
            id="demo-title"
            eyebrow="04 / Demo"
            title="See it plan a real case"
            description="One de-identified LIDC-IDRI case, from scan to plan."
          />
        </Reveal>
        <Reveal delay={100}>
          <Panel padding="none" variant="inset" className="lp-demo">
            {playing && hasVideo ? (
              <video
                className="lp-demo__video"
                src={DEMO_VIDEO_URL}
                controls
                autoPlay
                playsInline
              />
            ) : (
              <>
                <HeroAnatomy
                  view="poster"
                  riskPreview={false}
                  pixelSize={4}
                  className="lp-demo__poster"
                  label="Demo video poster"
                />
                <div className="lp-demo__overlay">
                  {hasVideo ? (
                    <button
                      type="button"
                      className="lp-demo__play"
                      onClick={() => setPlaying(true)}
                    >
                      <IconPlay />
                      <span className="pf-visually-hidden">Play demo video</span>
                    </button>
                  ) : (
                    <span className="lp-demo__play lp-demo__play--disabled" aria-hidden="true">
                      <IconPlay />
                    </span>
                  )}
                  <p className="pf-mono lp-demo__caption">
                    {hasVideo ? "Watch the demo" : "Demo video coming soon"}
                  </p>
                </div>
              </>
            )}
          </Panel>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- Built with ---------------- */

const STACK: { role: string; name: string; href: string; note?: string }[] = [
  {
    role: "CT data",
    name: "LIDC-IDRI",
    href: "https://www.cancerimagingarchive.net/collection/lidc-idri/",
    note: "The Cancer Imaging Archive · CC BY 3.0",
  },
  {
    role: "Segmentation",
    name: "TotalSegmentator",
    href: "https://github.com/wasserth/TotalSegmentator",
  },
  { role: "3D", name: "three.js", href: "https://threejs.org" },
  {
    role: "Head and hand tracking",
    name: "MediaPipe",
    href: "https://ai.google.dev/edge/mediapipe",
  },
  { role: "Plans and summaries", name: "Gemini", href: "https://ai.google.dev/gemini-api" },
];

function BuiltWith() {
  return (
    <section id="built-with" className="lp-section" aria-labelledby="built-title">
      <div className="pf-container">
        <Reveal>
          <SectionHeader id="built-title" eyebrow="05 / Built with" title="Open data, open tools" />
        </Reveal>
        <Reveal delay={100}>
          <ul className="lp-stack">
            {STACK.map((s) => (
              <li key={s.name}>
                <a className="lp-stack__item" href={s.href} target="_blank" rel="noreferrer">
                  <span className="pf-mono pf-muted">{s.role}</span>
                  <span className="lp-stack__name">{s.name}</span>
                  {s.note && <span className="lp-stack__note">{s.note}</span>}
                </a>
              </li>
            ))}
          </ul>
          <p className="lp-attribution pf-muted">
            CT data from the LIDC-IDRI collection (Armato et al., <cite>Medical Physics</cite>{" "}
            2011), hosted by The Cancer Imaging Archive (Clark et al., <cite>J Digit Imaging</cite>{" "}
            2013), used under CC BY 3.0. Segmentation by TotalSegmentator (Wasserthal et al.,{" "}
            <cite>Radiology: AI</cite> 2023).
          </p>
        </Reveal>
      </div>
    </section>
  );
}
