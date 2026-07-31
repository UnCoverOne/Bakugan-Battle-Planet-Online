import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { summarizeGuestData } from "../lib/guest-data";
import type { UserSnapshot } from "../lib/persistence";

const source = (path: string) => readFileSync(path, "utf8");
const guestSnapshot = (overrides: Partial<UserSnapshot> = {}) => ({
  profile: { name: "DanBrawler", faction: "Pyrus", signedIn: false },
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

test("logged-out avatar menu exposes Login then Register and reuses one account modal", () => {
  const shell = source("components/application/AppShell.jsx");
  const menu = shell.slice(shell.indexOf('<nav aria-label="Profile menu">'), shell.indexOf("</nav>", shell.indexOf('<nav aria-label="Profile menu">')));
  assert.match(menu, /authUser \?/);
  assert.ok(menu.indexOf("Log In") < menu.indexOf("Register"));
  assert.match(menu, /requestAccountAccess\("login"\)/);
  assert.match(menu, /requestAccountAccess\("signup"\)/);
  assert.match(shell, /AccountAccessModal/);
  assert.match(shell, /GuestAccountPrompt/);
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

  const customizedIdentity = summarizeGuestData(guestSnapshot({
    profile: {
      name: "DanBrawler",
      faction: "Pyrus",
      signedIn: false,
      avatar: "preset:bb-343",
      showcaseAchievementIds: ["first-win"],
    },
  }));
  assert.equal(customizedIdentity.profileCustomized, true);
  assert.match(customizedIdentity.labels.join(" · "), /custom Brawler profile/);
});

test("data import is offered once during registration and never during login", () => {
  const modal = source("components/application/AccountAccessModal.tsx");
  assert.match(modal, /mode === "signup" && guestData\.hasMeaningfulData/);
  assert.match(modal, /setStep\("transfer"\)/);
  assert.match(modal, /only time local guest data can be added/);
  assert.match(modal, /Bring local data/);
  assert.match(modal, /Start with an empty account/);
  assert.match(modal, /importLocalData: mode === "signup"/);
  assert.doesNotMatch(modal, /After login, use which data/);
  assert.doesNotMatch(modal, /Use cloud copy/);
  assert.match(modal, /returnTo: pathname/);
});

test("deck saves and completed matches trigger dismissible, non-blocking account prompts", () => {
  const decks = source("components/routes/DeckRoutes.tsx");
  const provider = source("components/application/AppProvider.jsx");
  const prompt = source("components/application/AccountAccessModal.tsx");
  assert.match(decks, /promptAccount\("deck-saved"\)/);
  assert.match(provider, /setAccountPrompt\("match-complete"\)/);
  assert.match(prompt, /Not now/);
  assert.match(prompt, /Deck saved on this device/);
  assert.match(prompt, /Match complete/);
});


test("signed-in routes block instead of falling back to guest data", () => {
  const shell = source("components/application/AppShell.jsx");
  assert.match(shell, /authUser && !accountDataReady/);
  assert.match(shell, /Cloud data could not be loaded/);
  assert.match(shell, /local guest data is isolated/);
  assert.match(shell, /retryCloudLoad/);
});
