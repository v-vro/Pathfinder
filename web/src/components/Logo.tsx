import "./components.css";

/** The Pathfinder wordmark: white on transparent (public/pathfinder-logo-white-transparent.svg). */
export function Logo({ height = 26 }: { height?: number }) {
  return (
    <img
      src="/pathfinder-logo-white-transparent.svg"
      alt="Pathfinder"
      height={height}
      width={Math.round((height * 698) / 165)}
      className="pf-logo"
      style={{ height }}
    />
  );
}
