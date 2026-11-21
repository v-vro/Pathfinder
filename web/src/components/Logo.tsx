import "./components.css";

/** The Pathfinder wordmark for dark backgrounds (public/logo-on-dark.png, made from public/logo.png). */
export function Logo({ height = 26 }: { height?: number }) {
  return (
    <img
      src="/logo-on-dark.png"
      alt="Pathfinder"
      height={height}
      width={Math.round(height * 5.016)}
      className="pf-logo"
      style={{ height }}
    />
  );
}
