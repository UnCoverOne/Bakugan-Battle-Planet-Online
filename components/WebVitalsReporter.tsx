"use client";

import { useEffect, useRef } from "react";

import { usePathname } from "next/navigation";

type MetricName = "CLS" | "INP" | "LCP" | "TTFB" | "NAV";
const safeRoute = (route: string) => route.replace(/[^a-zA-Z0-9/_-]/g, "").slice(0, 120) || "/";

/**
 * Anonymous, sampled real-user performance monitoring. Only the route name,
 * metric name, numeric value, and coarse device category are submitted.
 */
export function WebVitalsReporter() {
  const pathname = usePathname();
  const sampled = useRef(false);
  const started = useRef<{ path: string; at: number } | null>(null);
  const previousPath = useRef(pathname);
  const reportNavigation = useRef<(path: string, value: number) => void>(() => {});
  useEffect(() => {
    if (!("PerformanceObserver" in window) || Math.random() > 0.1) return;
    sampled.current = true;
    const documentRoute = safeRoute(window.location.pathname);
    const navigationSamples: { route: string; metric: MetricName; value: number }[] = [];
    reportNavigation.current = (path, value) => { navigationSamples.push({ route: safeRoute(path), metric: "NAV", value }); if (navigationSamples.length > 20) navigationSamples.shift(); };
    const onClick = (event: MouseEvent) => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href);
      if (url.origin === location.origin && url.pathname !== location.pathname) started.current = { path: url.pathname, at: performance.now() };
    };
    const onPopState = () => { started.current = { path: location.pathname, at: performance.now() }; };
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    const metrics = new Map<MetricName, number>();
    const observers: PerformanceObserver[] = [];
    const observe = (type: string, handler: (entry: PerformanceEntry) => void) => {
      try {
        const observer = new PerformanceObserver((list) => list.getEntries().forEach(handler));
        observer.observe({ type, buffered: true, ...(type === "event" ? { durationThreshold: 16 } : {}) } as PerformanceObserverInit);
        observers.push(observer);
      } catch {
        // Older browsers can ignore unsupported metric types.
      }
    };

    let cumulativeLayoutShift = 0;
    let sessionShift = 0;
    let firstShift = 0;
    let lastShift = 0;
    observe("layout-shift", (entry) => {
      const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
      if (!shift.hadRecentInput) {
        if (!sessionShift || entry.startTime - lastShift > 1000 || entry.startTime - firstShift > 5000) { sessionShift = 0; firstShift = entry.startTime; }
        sessionShift += shift.value ?? 0; lastShift = entry.startTime;
        cumulativeLayoutShift = Math.max(cumulativeLayoutShift, sessionShift);
      }
      metrics.set("CLS", cumulativeLayoutShift);
    });
    observe("largest-contentful-paint", (entry) => metrics.set("LCP", entry.startTime));
    const interactions = new Map<number, number>();
    let firstInteractionId = Infinity;
    let lastInteractionId = 0;
    observe("event", (entry) => {
      const interactionId = (entry as PerformanceEntry & { interactionId?: number }).interactionId;
      if (!interactionId) return;
      firstInteractionId = Math.min(firstInteractionId, interactionId);
      lastInteractionId = Math.max(lastInteractionId, interactionId);
      interactions.set(interactionId, Math.max(interactions.get(interactionId) ?? 0, entry.duration));
      if (interactions.size > 10) {
        const shortest = [...interactions].sort((a, b) => a[1] - b[1])[0];
        interactions.delete(shortest[0]);
      }
      const durations = [...interactions.values()].sort((a, b) => b - a);
      const interactionCount = (performance as Performance & { interactionCount?: number }).interactionCount ?? ((lastInteractionId - firstInteractionId) / 7 + 1);
      metrics.set("INP", durations[Math.min(durations.length - 1, Math.floor(interactionCount / 50))]);
    });
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigation) metrics.set("TTFB", Math.max(0, navigation.responseStart));

    const send = () => {
      const route = documentRoute;
      const device = window.innerWidth < 700 ? "small" : window.innerWidth < 1100 ? "medium" : "large";
      const samples = [...[...metrics].map(([metric, value]) => ({ route, metric, value })), ...navigationSamples.splice(0)]
        .filter(sample => Number.isFinite(sample.value) && sample.value >= 0)
        .map(sample => ({ ...sample, value: Math.round(sample.value * 1000) / 1000, device }));
      if (samples.length) navigator.sendBeacon("/api/rum", new Blob([JSON.stringify({ samples })], { type: "application/json" }));
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
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
      sampled.current = false;
      observers.forEach((observer) => observer.disconnect());
    };
  }, []);
  useEffect(() => {
    const changed = previousPath.current !== pathname;
    previousPath.current = pathname;
    if (!changed || !sampled.current) return;
    const start = started.current;
    started.current = null;
    // Only label transitions whose start was observed. Document metrics remain document-scoped.
    if (!start || start.path !== pathname) return;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => reportNavigation.current(pathname, performance.now() - start.at)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [pathname]);
  return null;
}
