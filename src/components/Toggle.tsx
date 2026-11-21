import { useId, type ReactNode } from "react";
import "./components.css";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  /** Optional mono hint shown under the label, e.g. "Shift+R". */
  hint?: ReactNode;
  disabled?: boolean;
  /** Hide the label visually (still read by screen readers). */
  hideLabel?: boolean;
  className?: string;
}

/** Accessible on/off switch (role="switch"). */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
  hideLabel,
  className,
}: ToggleProps) {
  const id = useId();
  return (
    <div
      className={["pf-toggle", disabled && "pf-toggle--disabled", className]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className="pf-toggle__track"
        onClick={() => onChange(!checked)}
      >
        <span className="pf-toggle__thumb" />
      </button>
      <label htmlFor={id} className={hideLabel ? "pf-visually-hidden" : "pf-toggle__label"}>
        <span>{label}</span>
        {hint && <span className="pf-toggle__hint pf-mono">{hint}</span>}
      </label>
    </div>
  );
}
