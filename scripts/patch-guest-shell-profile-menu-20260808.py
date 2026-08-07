from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}: {old!r}; found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "components/application/AppProvider.jsx",
    '''const defaults = {\n  profile: DEFAULT_BRAWLER_PROFILE,\n  settings: DEFAULT_APP_SETTINGS,\n};\nconst paths =''',
    '''const defaults = {\n  profile: DEFAULT_BRAWLER_PROFILE,\n  settings: DEFAULT_APP_SETTINGS,\n};\nconst PROFILE_FACTIONS = new Set(["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"]);\nconst identityStoredValue = (value) => value;\n\nfunction normalizeStoredProfile(value) {\n  const candidate = value && typeof value === "object" && !Array.isArray(value) ? value : {};\n  const name = typeof candidate.name === "string" && candidate.name.trim()\n    ? candidate.name.trim().slice(0, 20)\n    : defaults.profile.name;\n  const faction = PROFILE_FACTIONS.has(candidate.faction)\n    ? candidate.faction\n    : defaults.profile.faction;\n  return {\n    ...defaults.profile,\n    ...candidate,\n    name,\n    faction,\n    signedIn: Boolean(candidate.signedIn),\n    avatar: typeof candidate.avatar === "string" ? candidate.avatar : defaults.profile.avatar,\n    titleId: typeof candidate.titleId === "string" ? candidate.titleId : defaults.profile.titleId,\n    coverId: typeof candidate.coverId === "string" ? candidate.coverId : defaults.profile.coverId,\n    showcaseAchievementIds: Array.isArray(candidate.showcaseAchievementIds)\n      ? candidate.showcaseAchievementIds.filter((item) => typeof item === "string").slice(0, 3)\n      : [],\n    showcaseDeckIds: Array.isArray(candidate.showcaseDeckIds)\n      ? candidate.showcaseDeckIds.filter((item) => typeof item === "string").slice(0, 3)\n      : [],\n  };\n}\n\nfunction normalizeStoredArray(value) {\n  return Array.isArray(value) ? value : [];\n}\n\nfunction normalizeStoredSettings(value) {\n  return value && typeof value === "object" && !Array.isArray(value)\n    ? { ...defaults.settings, ...value }\n    : { ...defaults.settings };\n}\n\nconst paths =''',
)

replace_once(
    "components/application/AppProvider.jsx",
    '''  const { storage = "local", debounceMs = 500, report = true, migrateFromLocal = false, writeEnabled = true } = options;''',
    '''  const { storage = "local", debounceMs = 500, report = true, migrateFromLocal = false, writeEnabled = true, normalize = identityStoredValue } = options;''',
)

replace_once(
    "components/application/AppProvider.jsx",
    '''        if (saved !== null) {\n          lastSerialized.current = saved;\n          setValue(JSON.parse(saved));\n        } else {''',
    '''        if (saved !== null) {\n          const normalized = normalize(JSON.parse(saved));\n          lastSerialized.current = JSON.stringify(normalized);\n          setValue(normalized);\n        } else {''',
)

replace_once(
    "components/application/AppProvider.jsx",
    '''  }, [key, migrateFromLocal, storage]);''',
    '''  }, [key, migrateFromLocal, normalize, storage]);''',
)

for old, new in [
    (
        '''  const [profile, setProfile, profileReady] = useStoredState("bbp-profile", defaults.profile, { writeEnabled: writeLocal });''',
        '''  const [profile, setProfile, profileReady] = useStoredState("bbp-profile", defaults.profile, { normalize: normalizeStoredProfile, writeEnabled: writeLocal });''',
    ),
    (
        '''  const [decks, setStoredDecks, decksReady] = useStoredState("bbp-decks-complete-set-v4", [], { debounceMs: 750, writeEnabled: writeLocal });''',
        '''  const [decks, setStoredDecks, decksReady] = useStoredState("bbp-decks-complete-set-v4", [], { debounceMs: 750, normalize: normalizeStoredArray, writeEnabled: writeLocal });''',
    ),
    (
        '''  const [deletedDecks, setDeletedDecks, deletedDecksReady] = useStoredState("bbp-deleted-decks-v1", [], { debounceMs: 750, report: false, writeEnabled: writeLocal });''',
        '''  const [deletedDecks, setDeletedDecks, deletedDecksReady] = useStoredState("bbp-deleted-decks-v1", [], { debounceMs: 750, normalize: normalizeStoredArray, report: false, writeEnabled: writeLocal });''',
    ),
    (
        '''  const [history, setHistory, historyReady] = useStoredState("bbp-history", [], { debounceMs: 750, writeEnabled: writeLocal });''',
        '''  const [history, setHistory, historyReady] = useStoredState("bbp-history", [], { debounceMs: 750, normalize: normalizeStoredArray, writeEnabled: writeLocal });''',
    ),
    (
        '''  const [settings, setSettings, settingsReady] = useStoredState("bbp-settings", defaults.settings, { writeEnabled: writeLocal });''',
        '''  const [settings, setSettings, settingsReady] = useStoredState("bbp-settings", defaults.settings, { normalize: normalizeStoredSettings, writeEnabled: writeLocal });''',
    ),
]:
    replace_once("components/application/AppProvider.jsx", old, new)

replace_once(
    "app/website-overhaul.css",
    '''.profile-popover nav{display:grid;width:100%;padding:.35rem 0}\n.profile-popover-row{box-sizing:border-box;min-height:44px;display:grid;grid-template-columns:1.1em minmax(0,1fr) .85em;align-items:center;justify-self:stretch;gap:4%;width:100%;padding:0 5% 0 4%;border:0;border-radius:0;background:none;color:#dce8ec;text-align:left;font-size:.84rem;font-weight:800;text-decoration:none}''',
    '''.profile-popover>nav{display:grid;grid-template-columns:minmax(0,1fr);width:100%;padding:.35rem 0}\n.profile-popover>nav>.profile-popover-row{box-sizing:border-box;min-height:44px;display:grid;grid-template-columns:1.1em minmax(0,1fr) .85em;align-items:center;align-self:stretch;justify-self:stretch;gap:4%;width:100%;min-width:100%;max-width:none;margin:0;padding:0 5% 0 4%;border:0;border-radius:0;background:none;color:#dce8ec;text-align:left;font-size:.84rem;font-weight:800;text-decoration:none}''',
)

replace_once(
    "tests/guest-first-auth.test.ts",
    '''test("guest identity is generic and the avatar menu exposes only account access and Settings", () => {\n  const controller = source("components/application/GuestExperienceController.tsx");\n  const shell = source("components/application/AppShell.jsx");\n  const css = source("app/guest-experience.css");''',
    '''test("guest identity is generic and the avatar menu exposes only account access and Settings", () => {\n  const controller = source("components/application/GuestExperienceController.tsx");\n  const shell = source("components/application/AppShell.jsx");\n  const css = source("app/guest-experience.css");''',
)

anchor = '''test("guest-data detection ignores a fresh profile and identifies meaningful progress", () => {'''
insert = '''test("guest boot normalizes legacy local shell data before rendering", () => {\n  const provider = source("components/application/AppProvider.jsx");\n  assert.match(provider, /normalizeStoredProfile/);\n  assert.match(provider, /normalizeStoredArray/);\n  assert.match(provider, /normalizeStoredSettings/);\n  assert.match(provider, /const normalized = normalize\(JSON\.parse\(saved\)\)/);\n  assert.match(provider, /bbp-profile[\\s\\S]*normalize: normalizeStoredProfile/);\n  assert.match(provider, /bbp-decks-complete-set-v4[\\s\\S]*normalize: normalizeStoredArray/);\n  assert.match(provider, /bbp-history[\\s\\S]*normalize: normalizeStoredArray/);\n  assert.match(provider, /bbp-settings[\\s\\S]*normalize: normalizeStoredSettings/);\n});\n\ntest("profile popover navigation rows span the full menu width", () => {\n  const css = source("app/website-overhaul.css");\n  assert.match(css, /\\.profile-popover>nav\\{[^}]*grid-template-columns:minmax\\(0,1fr\\);[^}]*width:100%/);\n  assert.match(css, /\\.profile-popover>nav>\\.profile-popover-row\\{[^}]*width:100%;[^}]*min-width:100%;[^}]*max-width:none;[^}]*margin:0/);\n});\n\n'''
file = Path("tests/guest-first-auth.test.ts")
text = file.read_text()
if anchor not in text:
    raise SystemExit("guest-first test insertion anchor missing")
file.write_text(text.replace(anchor, insert + anchor, 1))
