"use client";

import { useState, type ReactNode } from "react";

/** Animate only a changed value, without timers or animating the initial grid. */
export function MotionValue({ value, children, kind = "count" }: {
  value: string | number | boolean;
  children?: ReactNode;
  kind?: "count" | "status";
}) {
  const [observed, setObserved] = useState({ value, changed: false });
  if (!Object.is(observed.value, value)) setObserved({ value, changed: true });
  return <span key={String(value)} data-ui="motion-value" data-changed={observed.changed || undefined} data-kind={kind}>{children ?? String(value)}</span>;
}
