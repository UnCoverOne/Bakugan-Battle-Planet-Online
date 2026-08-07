from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    source = file.read_text()
    if old not in source:
        raise SystemExit(f"Missing patch anchor: {label} ({path})")
    file.write_text(source.replace(old, new, 1))


# Remove the top-navigation sync affordance without changing persistence/sync behavior.
path = Path("components/application/AppShell.jsx")
source = path.read_text()
source = source.replace('import { deriveSyncIndicator } from "../../lib/client-status";\n', "", 1)
source = source.replace('    syncStatus,\n    storageHealth,\n', "", 1)
start = source.find("\nfunction SyncGlyph({ cloud }) {")
end = source.find("\nexport function AppShell", start)
if start < 0 or end < 0:
    raise SystemExit("Missing patch anchor: SyncGlyph")
source = source[:start] + "\n" + source[end:]
indicator = '''  const syncIndicator = deriveSyncIndicator({
    authenticated: Boolean(authUser),
    syncStatus,
    storageStatus: storageHealth.status,
    storageMessage: storageHealth.message,
  });
'''
if indicator not in source:
    raise SystemExit("Missing patch anchor: syncIndicator")
source = source.replace(indicator, "", 1)
sync_link = '''            <Link
              href="/profile"
              className={`sync-dot ${syncIndicator.tone}`}
              title={syncIndicator.title}
              aria-label={syncIndicator.title}
            >
              <SyncGlyph cloud={Boolean(authUser)} />
            </Link>
'''
if sync_link not in source:
    raise SystemExit("Missing patch anchor: sync top-nav link")
source = source.replace(sync_link, "", 1)
path.write_text(source)

# Give shared shell chrome a stacking layer above route-local sticky controls.
replace_once(
    "app/website-overhaul.css",
    '.app-shell:not(.immersive-match) .overhaul-topbar{height:76px;grid-template-columns:210px minmax(360px,1fr) auto;padding:0 clamp(1rem,3vw,2.25rem);box-shadow:0 10px 35px rgba(0,0,0,.28)}',
    '.app-shell:not(.immersive-match) .overhaul-topbar{height:76px;z-index:200;grid-template-columns:210px minmax(360px,1fr) auto;padding:0 clamp(1rem,3vw,2.25rem);box-shadow:0 10px 35px rgba(0,0,0,.28)}',
    "shell overlay stacking layer",
)
path = Path("app/website-overhaul.css")
source = path.read_text()
for rule in [
    '.sync-dot{display:grid;place-items:center;width:38px;height:38px;border:1px solid rgba(255,255,255,.15);border-radius:50%;background:#061923;color:#8fb2bf;font-size:.95rem}\n',
    '.sync-dot.synced{color:#6be68a;border-color:rgba(107,230,138,.38)}\n',
    '.sync-dot.working{color:#8fb2bf;border-color:rgba(143,178,191,.3)}\n',
    '.sync-dot.warning{color:#f1c75b;border-color:rgba(241,199,91,.45)}\n',
    '.sync-dot.error{color:#ff6468;border-color:rgba(255,100,104,.48)}\n',
]:
    if rule not in source:
        raise SystemExit(f"Missing patch anchor: {rule[:30]}")
    source = source.replace(rule, "", 1)
path.write_text(source)

# Remove now-unused Home-only sync icon presentation.
path = Path("app/home-layout.css")
source = path.read_text()
block = '''.app-shell:has(.bakugan-home) .sync-dot {
  width: 40px;
  height: 40px;
  color: #fff;
  background: rgba(4, 17, 24, .9);
}
.sync-icon {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
'''
if block not in source:
    raise SystemExit("Missing patch anchor: Home sync styles")
path.write_text(source.replace(block, "", 1))

# Update the shell regression to lock both requested behaviors.
path = Path("tests/website-overhaul.test.ts")
source = path.read_text()
source = source.replace('  assert.match(shell, /function SyncGlyph/);\n  assert.match(shell, /className="sync-icon"/);\n', '  assert.doesNotMatch(shell, /function SyncGlyph/);\n  assert.doesNotMatch(shell, /sync-dot|sync-icon|syncIndicator|deriveSyncIndicator/);\n', 1)
anchor = '  assert.match(shellCss, /\\.profile-popover-chevron\\{[^}]*justify-self:end/);\n'
if anchor not in source:
    raise SystemExit("Missing patch anchor: shell CSS assertions")
source = source.replace(
    anchor,
    anchor
    + '  assert.match(shellCss, /\\.app-shell:not\\(\\.immersive-match\\) \\.overhaul-topbar\\{[^}]*z-index:200/);\n'
    + '  assert.doesNotMatch(shellCss, /\\.sync-dot/);\n'
    + '  assert.doesNotMatch(homeLayoutCss, /\\.sync-dot|\\.sync-icon/);\n',
    1,
)
path.write_text(source)

# Extend the existing Compendium visual contract to check the route sticky toolbar
# cannot paint above the open account menu.
path = Path("tests/visual/foundation.spec.ts")
source = path.read_text()
anchor = '''    expect(geometry).toHaveLength(3);
    for (const row of geometry) {
      expect(Math.abs(row.rowLeft - row.navigationLeft)).toBeLessThanOrEqual(1);
      expect(Math.abs(row.rowRight - row.navigationRight)).toBeLessThanOrEqual(1);
      expect(row.labelAlignment).toBe("left");
      expect(row.labelLeft).toBeLessThan(row.chevronLeft);
      expect(row.chevronRight).toBeLessThanOrEqual(row.rowRight);
    }
'''
if anchor not in source:
    raise SystemExit("Missing patch anchor: account menu visual regression")
replacement = anchor + '''
    if (route === "/compendium") {
      const layers = await page.evaluate(() => {
        const topbar = document.querySelector<HTMLElement>(".overhaul-topbar");
        const toolbar = document.querySelector<HTMLElement>("main [class*='toolbar']");
        return {
          topbar: Number(getComputedStyle(topbar!).zIndex),
          toolbar: Number(getComputedStyle(toolbar!).zIndex),
        };
      });
      expect(layers.topbar).toBeGreaterThan(layers.toolbar);
    }
'''
source = source.replace(anchor, replacement, 1)
path.write_text(source)
