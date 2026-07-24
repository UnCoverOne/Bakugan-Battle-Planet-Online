"use client";

import { useEffect } from "react";

type MetricName = "CLS" | "INP" | "LCP" | "TTFB";

/**
 * Anonymous, sampled real-user performance monitoring. Only the route name,
 * metric name, numeric value, and coarse device category are submitted.
 */
export function WebVitalsReporter() {
  useEffect(() => {
    if (!("PerformanceObserver" in window) || Math.random() > 0.1) return;
    const metrics = new Map<MetricName, number>();
    const observers: PerformanceObserver[] = [];
    const observe = (type: string, handler: (entry: PerformanceEntry) => void) => {
      try {
        const observer = new PerformanceObserver((list) => list.getEntries().forEach(handler));
        observer.observe({ type, buffered: true } as PerformanceObserverInit);
        observers.push(observer);
      } catch {
        // Older browsers can ignore unsupported metric types.
      }
    };

    let cumulativeLayoutShift = 0;
    observe("layout-shift", (entry) => {
      const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
      if (!shift.hadRecentInput) cumulativeLayoutShift += shift.value ?? 0;
      metrics.set("CLS", cumulativeLayoutShift);
    });
    observe("largest-contentful-paint", (entry) => metrics.set("LCP", entry.startTime));
    observe("event", (entry) => {
      if (entry.duration > (metrics.get("INP") ?? 0)) metrics.set("INP", entry.duration);
    });
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigation) metrics.set("TTFB", Math.max(0, navigation.responseStart));

    const send = () => {
      const route = window.location.pathname.replace(/[^a-zA-Z0-9/_-]/g, "").slice(0, 120) || "/";
      const device = window.innerWidth < 700 ? "small" : window.innerWidth < 1100 ? "medium" : "large";
      for (const [metric, value] of metrics) {
        if (!Number.isFinite(value) || value < 0) continue;
        navigator.sendBeacon(
          "/api/rum",
          new Blob([JSON.stringify({ route, metric, value: Math.round(value * 1000) / 1000, device })], {
            type: "application/json",
          }),
        );
      }
      metrics.clear();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") send();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", send);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", send);
      observers.forEach((observer) => observer.disconnect());
    };
  }, []);
  return null;
}
