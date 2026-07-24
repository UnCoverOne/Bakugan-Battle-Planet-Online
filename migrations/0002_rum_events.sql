CREATE TABLE IF NOT EXISTS rum_events (
  id TEXT PRIMARY KEY NOT NULL,
  route TEXT NOT NULL,
  metric TEXT NOT NULL CHECK (metric IN ('CLS', 'INP', 'LCP', 'TTFB')),
  value REAL NOT NULL,
  device TEXT NOT NULL CHECK (device IN ('small', 'medium', 'large')),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS rum_events_metric_created_idx
  ON rum_events (metric, created_at);

CREATE INDEX IF NOT EXISTS rum_events_route_created_idx
  ON rum_events (route, created_at);
