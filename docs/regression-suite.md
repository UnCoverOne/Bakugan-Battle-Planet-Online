# Regression test suite

The blocking **Continuous Integration** workflow runs one lint pass, one production build
(inside `npm test`), the bundle budget, the current Node regression suite,
and the Cloudflare security-header unit smoke test. This replaces overlapping
workflows and multiple full-suite rebuilds. Content validation remains path-filtered.

## Commands

- `npm test` — blocking Node tests with production build and security checks
- `npm run test:core` — runnable Node tests without rebuilding
- `npm run test:extended` — **all** root-level TypeScript tests, including known failures
- `npm run test:quarantine` — only known failing legacy tests
- `npm run test:visual` — Playwright browser checks
- `npm run test:rules` and `npm run test:engine` — focused developer subsets

The Node runner discovers `tests/*.test.ts` automatically, so new root-level test
files are no longer left unwired. Four Playwright files run separately, manually
and each Saturday (04:00 UTC), alongside the visibly failing quarantined tests.

## Quarantine

See [`tests/quarantine.json`](../tests/quarantine.json) for currently excluded
files and individual reasons. They are **not** considered obsolete simply because
they fail. Re-enable each after repairing its fixture or confirming a stronger
current test. Do not delete genuine rules failures to get a passing suite.

The legacy audit snapshot had 154 test files (150 Node, four Playwright) and an
886-case default suite, red due to a nondeterministic Sync fixture. The expanded
inventory exposed 47 failures across 1,188 cases, many from outdated test contracts
but others requiring real gameplay investigation. This is why the quarantine
exists instead of treating all 1,188 as a healthy baseline.
