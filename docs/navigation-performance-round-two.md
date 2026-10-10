# Navigation performance: second round

## Changes

- Collection query, filters, inspector, and pagination use local history updates. Search stays controlled, uses deferred filtering, and replaces the URL after 180 ms. Back/forward and shared URLs remain supported.
- Collection builds one catalogue identity index per revision and one aggregate-count map per collection change, preserving alternate printings and fusion-face rules.
- Builder reuses search indexes and frequency maps, builds only the active category, and defers query work. Native `content-visibility` skips offscreen gallery rendering while retaining DOM, keyboard targets, and the existing 240-result limit.
- Authentication starts alongside local restoration. Large guest history and replay state restore only when their routes or account flows require them. Signed-in sessions restore local history before account reconciliation; deferred state cannot overwrite newer explicit updates.
- Local persistence serializes the latest settled value, flushes on pagehide/hidden/unmount, and cancels local writes when account scope changes. Durable change tracking uses dependency identity instead of repeatedly serializing the account graph.
- Public catalogue, offline fallback, home recommendations, ranked rules, and override refreshes share bounded memory caches and in-flight requests. Viewer keys isolate personalized responses; mutation paths invalidate cached data. Stale catalogue content stays visible during refresh or temporary network failure.
- Empty and unchanged card overrides avoid catalogue import/reset. Routes without catalogue use do not initialize it solely for override refresh.
- Artwork URLs use hashes of their directory contents, independent of application build identity. Grouping hashes keeps the client manifest small; editing one file invalidates that directory, rather than the entire deployment. Content-revision artwork has a persistent cache with periodic FIFO cleanup (600 entries / 64 MiB targets, maximum 2 MiB per cached response). Unversioned assets and application scripts remain build scoped.
- Deck screens and their library/detail/catalogue/inspection helpers load separately. Deck-image export loads only when requested.
- Document performance measurements retain their initial route attribution. Sampled link and back/forward transitions record `NAV` click/transition-to-paint timing; unobserved programmatic transitions are not mislabeled. CLS uses session windows, interaction samples use interaction IDs, and telemetry submits bounded batches. The API still accepts legacy single samples.

## Verification

Production build and Cloudflare artifact validation pass, as do bundle budgets and focused navigation, persistence, history, replay, and account-sync tests. New regressions cover identity groups, cache deduplication/account separation/invalidation/failure, storage serialization/lifecycle/deferred restoration/corruption, stable art revisions, cross-build cache reuse, and eviction.

The baseline combined deck-route chunk was 79,433 bytes. After splitting, the private library screen plus its library and general helpers totals approximately 24 KiB; shared catalogue, framework, styling, and other dependencies are additional. This measures code delivery, not browser navigation speed.

Two existing source-contract tests fail unchanged on the baseline: “AI deck registry controls Training AI selection” and “all legality boundaries delegate to the centralized engine.” The repository also has existing TypeScript diagnostics; comparison against the baseline found no new diagnostic categories from this change.

Visual browser checks remain unverified in this environment: Chromium downloads arrive truncated, and the local Cloudflare runtime fails to start (`uv_interface_addresses`). No visual assets were modified or compressed.
