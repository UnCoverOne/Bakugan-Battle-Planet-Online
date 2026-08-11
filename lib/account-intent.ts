export type AccountIntentReason =
  | "generic"
  | "achievements"
  | "profile"
  | "publish-deck"
  | "favorite-deck"
  | "protect-progress"
  | "deck-saved"
  | "match-complete";

export type AccountIntent = {
  reason: AccountIntentReason;
  deckId?: string;
  returnTo?: string;
  createdAt: number;
};

const ACCOUNT_INTENT_KEY = "bbp-account-intent-v1";
const MAX_INTENT_AGE_MS = 30 * 60 * 1000;

export function rememberAccountIntent(
  reason: AccountIntentReason,
  options: Pick<AccountIntent, "deckId" | "returnTo"> = {},
) {
  if (typeof window === "undefined") return;
  const intent: AccountIntent = {
    reason,
    deckId: options.deckId,
    returnTo: options.returnTo,
    createdAt: Date.now(),
  };
  try {
    window.sessionStorage.setItem(ACCOUNT_INTENT_KEY, JSON.stringify(intent));
  } catch {
    // Account access remains usable when session storage is unavailable.
  }
}

export function readAccountIntent(): AccountIntent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ACCOUNT_INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AccountIntent>;
    if (
      typeof parsed.reason !== "string" ||
      typeof parsed.createdAt !== "number" ||
      Date.now() - parsed.createdAt > MAX_INTENT_AGE_MS
    ) {
      window.sessionStorage.removeItem(ACCOUNT_INTENT_KEY);
      return null;
    }
    return parsed as AccountIntent;
  } catch {
    return null;
  }
}

export function clearAccountIntent() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(ACCOUNT_INTENT_KEY);
  } catch {
    // Nothing else is required.
  }
}

export function accountIntentCopy(reason: AccountIntentReason | undefined) {
  switch (reason) {
    case "achievements":
      return {
        eyebrow: "Unlock your progress",
        title: "Create your Brawler account",
        copy: "Bring your local decks and eligible match records with you, then unlock the achievements you have earned.",
      };
    case "profile":
      return {
        eyebrow: "Claim your identity",
        title: "Create your Brawler profile",
        copy: "Choose a permanent Brawler name, customise your profile, and showcase achievements and Public decks.",
      };
    case "publish-deck":
      return {
        eyebrow: "Publish your strategy",
        title: "Create an account to publish",
        copy: "Your deck is safe on this device. Create an account and it will be published under your Brawler name.",
      };
    case "favorite-deck":
      return {
        eyebrow: "Save a public strategy",
        title: "Create an account to favorite decks",
        copy: "Favorites follow your Brawler account across devices and contribute once to each deck's community total.",
      };
    case "match-complete":
      return {
        eyebrow: "Match complete",
        title: "Protect your battle record",
        copy: "Create an account to keep eligible match records, unlock achievements, and continue on another device.",
      };
    case "deck-saved":
    case "protect-progress":
      return {
        eyebrow: "Protect local progress",
        title: "Keep your decks everywhere",
        copy: "Create an account to back up local decks and settings and use them across devices.",
      };
    default:
      return {
        eyebrow: "Brawler account",
        title: "Create your account",
        copy: "Unlock achievements, publish decks, customise your profile, and protect your progress across devices.",
      };
  }
}
