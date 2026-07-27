"use client";

import type {
  ButtonHTMLAttributes,
  CSSProperties,
  ElementType,
  HTMLAttributes,
  ReactNode,
} from "react";
import styles from "./primitives.module.css";

const join = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

type SurfaceProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  elevation?: "flat" | "raised" | "overlay";
};

export function Surface({
  as: Tag = "section",
  className,
  elevation = "raised",
  ...props
}: SurfaceProps) {
  return <Tag className={join(styles.surface, styles[elevation], className)} {...props} />;
}

export function RouteHero({
  eyebrow,
  title,
  description,
  actions,
  aside,
  className,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <header className={join(styles.routeHero, className)}>
      <div className={styles.routeHeroCopy}>
        <span className={styles.eyebrow}>{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {actions && <div className={styles.heroActions}>{actions}</div>}
      </div>
      {aside && <div className={styles.routeHeroAside}>{aside}</div>}
    </header>
  );
}

export function ActionButton({
  tone = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "secondary" | "danger" | "quiet";
}) {
  return <button className={join(styles.actionButton, styles[tone], className)} {...props} />;
}

export function StatusChip({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
}) {
  return <span className={join(styles.statusChip, styles[tone], className)} {...props} />;
}

export function Tabs({
  label,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { label: string }) {
  return <nav className={join(styles.tabs, className)} aria-label={label} {...props} />;
}

export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={join(styles.field, className)}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function CardGrid({
  minCardWidth = "18rem",
  className,
  style,
  ...props
}: HTMLAttributes<HTMLElement> & { minCardWidth?: string }) {
  return (
    <section
      className={join(styles.cardGrid, className)}
      style={{ ...style, "--card-grid-min": minCardWidth } as CSSProperties}
      {...props}
    />
  );
}
