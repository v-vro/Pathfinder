import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Link } from "react-router-dom";
import "./components.css";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

interface BaseProps {
  /**
   * primary: white fill, black text. The single main call to action on a view.
   * secondary: white outline, normal actions.
   * ghost: low-emphasis text button.
   */
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
  fullWidth?: boolean;
  className?: string;
  children?: ReactNode;
}

type AsButton = BaseProps &
  Omit<ComponentPropsWithoutRef<"button">, keyof BaseProps> & { to?: never; href?: never };
type AsRouterLink = BaseProps &
  Omit<ComponentPropsWithoutRef<typeof Link>, keyof BaseProps> & { to: string; href?: never };
type AsAnchor = BaseProps &
  Omit<ComponentPropsWithoutRef<"a">, keyof BaseProps> & { href: string; to?: never };

export type ButtonProps = AsButton | AsRouterLink | AsAnchor;

/** Renders a <button>, a router <Link> (pass `to`) or an <a> (pass `href`). */
export function Button(props: ButtonProps) {
  const {
    variant = "secondary",
    size = "md",
    iconStart,
    iconEnd,
    fullWidth,
    className,
    children,
    ...rest
  } = props;

  const classes = [
    "pf-btn",
    `pf-btn--${variant}`,
    `pf-btn--${size}`,
    fullWidth && "pf-btn--full",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      {iconStart && (
        <span className="pf-btn__icon" aria-hidden="true">
          {iconStart}
        </span>
      )}
      {children && <span>{children}</span>}
      {iconEnd && (
        <span className="pf-btn__icon" aria-hidden="true">
          {iconEnd}
        </span>
      )}
    </>
  );

  if ("to" in rest && rest.to !== undefined) {
    return (
      <Link className={classes} {...(rest as Omit<AsRouterLink, keyof BaseProps>)}>
        {content}
      </Link>
    );
  }
  if ("href" in rest && rest.href !== undefined) {
    return (
      <a className={classes} {...(rest as Omit<AsAnchor, keyof BaseProps>)}>
        {content}
      </a>
    );
  }
  const buttonProps = rest as Omit<AsButton, keyof BaseProps>;
  return (
    <button type="button" className={classes} {...buttonProps}>
      {content}
    </button>
  );
}
