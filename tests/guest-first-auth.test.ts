import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { summarizeGuestData } from "../lib/guest-data";
import type { UserSnapshot } from "../lib/persistence";

const source = (path: string) => readFileSync(path, "utf8");
const guestSnapshot = (overrides: Partial<UserSnapshot> = {}) => ({
  profile: { name: "Guest Brawler", faction: "Pyrus", signedIn: false },
  decks: [],
  history: [],
  settings: {
    reducedMotion: false,
    highContrast: false,
    sound: true,
    cardScale: 100,
    logDetail: "All events",
    challenges: "Everyone",
    replayLinks: true,
  },
  builderDeck: null,
  match: null,
  ...overrides,
}) as Pick<UserSnapshot, "profile" | "decks" | "history" | "settings" | "builderDeck" | "match">;

test("the root route is guest-first Home with no authentication landing page", () => {
  const root = source("app/page.tsx");
  const shell = source("components/application/AppShell.jsx");
  assert.match(root, /DashboardScreen/);
  assert.doesNotMatch(root, /EntryScreen/);
  assert.equal(existsSync("components/routes/EntryScreen.tsx"), false);
  assert.match(shell, /\{ href: "\/", label: "Home"/);
  assert.doesNotMatch(shell, /const publicEntry/);
  assert.match(source("app/(workspace)/dashboard/page.tsx"), /redirect\("\/"\)/);
});

test("guest identity is generic and the avatar menu exposes only account access and Settings", () => {
  const controller = source("components/application/GuestExperienceController.tsx");
  const shell = source("components/application/AppShell.jsx");
  const css = source("app/guest-experience.css");
  assert.match(controller, /GUEST_BRAWLER_NAME = "Guest Brawler"/);
  assert.match(controller, /setProfile\(\{ \.\.\.profile, name: GUEST_BRAWLER_NAME/);
  assert.match(shell, /requestAccountAccess\("login"\)/);
  assert.match(shell, /requestAccountAccess\("signup"\)/);
  assert.match(css, /profile-popover-stats[\s\S]*display: none/);
  assert.match(css, /a\[href="\/profile"\]/);
  assert.match(css, /a\[href="\/profile\/achievements"\]/);
  assert.match(css, /profile-popover-auth/);
});

test("guest boot normalizes legacy local shell data before rendering", () => {
  const provider = source("components/application/AppProvider.jsx");
  assert.match(provider, /normalizeStoredProfile/);
  assert.match(provider, /normalizeStoredArray/);
  assert.match(provider, /normalizeStoredSettings/);
  assert.match(provider, /const normalized = normalize\(JSON\.parse\(saved\)\)/);
  assert.match(provider, /bbp-profile[\s\S]*normalize: normalizeStoredProfile/);
  assert.match(provider, /bbp-decks-complete-set-v4[\s\S]*normalize: normalizeStoredArray/);
  assert.match(provider, /bbp-history[\s\S]*normalize: normalizeStoredArray/);
  assert.match(provider, /bbp-settings[\s\S]*normalize: normalizeStoredSettings/);
});

test("profile popover navigation rows span the full menu width", () => {
  const css = source("app/website-overhaul.css");
  assert.match(css, /\.profile-popover>nav\{[^}]*grid-template-columns:minmax\(0,1fr\);[^}]*width:100%/);
  assert.match(css, /\.profile-popover>nav>\.profile-popover-row\{[^}]*width:100%;[^}]*min-width:100%;[^}]*max-width:none;[^}]*margin:0/);
});

test("guest-data detection ignores a fresh profile and identifies meaningful progress", () => {
  const empty = summarizeGuestData(guestSnapshot());
  assert.equal(empty.hasMeaningfulData, false);
  assert.deepEqual(empty.labels, []);

  const populated = summarizeGuestData(guestSnapshot({
    decks: [{ id: "deck-1" }] as UserSnapshot["decks"],
    history: [{ id: "match-1" }] as UserSnapshot["history"],
    profile: { name: "Emma", faction: "Aquos", signedIn: false },
  }));
  assert.equal(populated.hasMeaningfulData, true);
  assert.equal(populated.deckCount, 1);
  assert.equal(populated.matchCount, 1);
  assert.match(populated.labels.join(" · "), /saved deck/);
  assert.match(populated.labels.join(" · "), /match record/);
  assert.match(populated.labels.join(" · "), /custom Brawler profile/);
});

test("registration uses one streamlined form with local import selected by default", () => {
  const modal = source("components/application/AccountAccessModal.tsx");
  assert.match(modal, /bringLocalData, setBringLocalData\] = useState\(true\)/);
  assert.match(modal, /Bring my local progress/);
  assert.match(modal, /importLocalData: view === "signup" && bringLocalData/);
  assert.doesNotMatch(modal, /setStep\("transfer"\)/);
  assert.doesNotMatch(modal, /Start with an empty account/);
  assert.match(modal, /Guest decks and progress remain preserved separately/);
  assert.match(modal, /intent\?\.returnTo/);
});

test("Home keeps guest navigation consistent and avoids duplicate account actions", () => {
  const dashboard = source("components/routes/DashboardScreen.tsx");
  const css = source("app/guest-experience.css");
  assert.match(dashboard, /Welcome to Battle Planet/);
  assert.match(dashboard, /<span>PLAY<\/span>/);
  assert.match(dashboard, /<span>DECKS<\/span>/);
  assert.doesNotMatch(dashboard, /START TRAINING/);
  assert.doesNotMatch(dashboard, /BUILD A DECK/);
  assert.match(dashboard, /achievement.*ready to unlock/is);
  assert.match(dashboard, /Playing as Guest Brawler/);
  assert.match(dashboard, /Protect My Progress/);
  assert.match(css, /\.home-account-gate \.home-account-gate-actions\s*\{\s*display: none;/);
  assert.match(css, /\.home-guest-progress\s*\{[\s\S]*display: flex;[\s\S]*align-items: center;/);
  assert.match(css, /\.home-guest-progress \.guest-progress-actions\s*\{[\s\S]*flex-wrap: nowrap;/);
});

test("guest Profile and Achievements routes redirect to an account benefits page", () => {
  const controller = source("components/application/GuestExperienceController.tsx");
  const accountPage = source("app/account/page.tsx");
  const accountScreen = source("components/routes/GuestAccountScreen.tsx");
  assert.match(controller, /pathname\.startsWith\("\/profile"\)/);
  assert.match(controller, /router\.replace\(`\/account\?feature=\$\{reason\}`\)/);
  assert.match(accountPage, /GuestAccountScreen/);
  assert.match(accountScreen, /Unlock achievements/);
  assert.match(accountScreen, /Publish Public decks/);
  assert.match(accountScreen, /Build your profile/);
});

test("guest Public deck saves are converted to Private and resumed after registration", () => {
  const controller = source("components/application/GuestExperienceController.tsx");
  const css = source("app/guest-experience.css");
  assert.match(controller, /deck\.visibility === "Public"/);
  assert.match(controller, /visibility: "Private" as const/);
  assert.match(controller, /promptAccount\("publish-deck"\)/);
  assert.match(controller, /intent\.reason !== "publish-deck"/);
  assert.match(controller, /visibility: "Public" as const/);
  assert.match(css, /Account required to publish/);
});

test("deck saves and completed matches trigger contextual dismissible account prompts", () => {
  const decks = source("components/routes/DeckRoutes.tsx");
  const provider = source("components/application/AppProvider.jsx");
  const prompt = source("components/application/AccountAccessModal.tsx");
  assert.match(decks, /promptAccount\("deck-saved"\)/);
  assert.match(provider, /setAccountPrompt\("match-complete"\)/);
  assert.match(prompt, /publish-deck/);
  assert.match(prompt, /Not now/);
  assert.match(prompt, /Deck saved on this device/);
  assert.match(prompt, /Match complete/);
});

test("password recovery uses rotating, hashed recovery codes", () => {
  const modal = source("components/application/AccountAccessModal.tsx");
  const route = source("app/api/auth/route.ts");
  const schema = source("db/schema.ts");
  assert.match(modal, /Forgot password\?/);
  assert.match(modal, /generateRecoveryCode/);
  assert.match(modal, /recover-password/);
  assert.match(route, /recovery_code_hash/);
  assert.match(route, /createPasswordRecord\(recoveryCode\)/);
  assert.match(route, /recoveryCodeMatches/);
  assert.match(route, /DELETE FROM sessions WHERE user_id/);
  assert.match(schema, /recoveryCodeHash/);
  assert.equal(existsSync("drizzle/0004_account_recovery.sql"), true);
});

test("signed-in routes block instead of falling back to guest data", () => {
  const shell = source("components/application/AppShell.jsx");
  assert.match(shell, /authUser && !accountDataReady/);
  assert.match(shell, /Cloud data could not be loaded/);
  assert.match(shell, /local guest data is isolated/);
  assert.match(shell, /retryCloudLoad/);
});
