"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import { useApp } from "./AppProvider";
import styles from "./AccountAccessModal.module.css";

export type AccountAccessMode = "login" | "signup";
type RegistrationChoice = "merge" | "fresh";

export function AccountAccessModal({
  mode,
  onClose,
}: {
  mode: AccountAccessMode;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const {
    profile,
    guestData,
    authBusy,
    authChecking,
    authError,
    authenticate,
    requestAccountAccess,
  } = useApp();
  const [step, setStep] = useState<"details" | "transfer">("details");
  const [displayName, setDisplayName] = useState(profile.name);
  const [faction, setFaction] = useState(profile.faction);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [strategy, setStrategy] = useState<RegistrationChoice>("merge");
  const [formError, setFormError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !authBusy) onClose();
    };
    addEventListener("keydown", escape);
    return () => removeEventListener("keydown", escape);
  }, [authBusy, onClose]);

  const validateDetails = () => {
    if (mode === "signup") {
      const normalizedName = displayName.trim().replace(/\s+/g, " ");
      if (!normalizedName) return "Brawler name cannot be blank.";
      if (!/^[\p{L}\p{N} _'-]+$/u.test(normalizedName)) {
        return "Use letters, numbers, spaces, apostrophes, underscores, or hyphens.";
      }
      if (/^(admin|administrator|moderator|official|support)$/i.test(normalizedName)) {
        return "That reserved Brawler name cannot be used.";
      }
      if (password !== confirmation) return "Passwords do not match.";
    }
    return "";
  };

  const finish = async (registrationChoice: RegistrationChoice = "fresh") => {
    const result = await authenticate(mode, {
      email,
      password,
      displayName: displayName.trim().replace(/\s+/g, " "),
      faction,
      importLocalData: mode === "signup" && registrationChoice === "merge",
      returnTo: pathname,
    });
    if (result?.ok) onClose();
  };

  const submitDetails = async (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    const error = validateDetails();
    if (error) return setFormError(error);
    if (mode === "signup" && guestData.hasMeaningfulData) {
      setStep("transfer");
      return;
    }
    await finish("fresh");
  };

  const submitTransfer = async (event: FormEvent) => {
    event.preventDefault();
    await finish(strategy);
  };

  return (
    <div className={styles.backdrop} onMouseDown={(event) => {
      if (event.target === event.currentTarget && !authBusy) onClose();
    }}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-access-title"
      >
        <header className={styles.header}>
          <div>
            <span>{step === "transfer" ? "Protect local progress" : "Brawler account"}</span>
            <h2 id="account-access-title">
              {step === "transfer"
                ? "Choose your data"
                : mode === "login"
                  ? "Log in"
                  : "Register"}
            </h2>
          </div>
          <button
            ref={closeRef}
            className={styles.close}
            type="button"
            aria-label="Close account window"
            disabled={authBusy}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        {step === "details" ? (
          <form className={styles.form} onSubmit={submitDetails}>
            {mode === "signup" && (
              <div className={styles.grid}>
                <label className={styles.field}>
                  Brawler name
                  <input
                    value={displayName}
                    maxLength={20}
                    autoComplete="nickname"
                    onChange={(event) => setDisplayName(event.target.value)}
                    required
                  />
                </label>
                <label className={styles.field}>
                  Preferred faction
                  <select value={faction} onChange={(event) => setFaction(event.target.value)}>
                    {["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <label className={styles.field}>
              Email address
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label className={styles.field}>
              Password
              <input
                type="password"
                minLength={10}
                maxLength={128}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <p className={styles.help}>Use 10–128 characters. A unique passphrase is recommended.</p>
            {mode === "signup" && (
              <label className={styles.field}>
                Confirm password
                <input
                  type="password"
                  minLength={10}
                  maxLength={128}
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                />
              </label>
            )}
            {(formError || authError) && (
              <p className={styles.error} role="alert">{formError || authError}</p>
            )}
            <p className={styles.switchMode}>
              {mode === "login" ? "New to Battle Planet?" : "Already have an account?"}
              <button
                type="button"
                onClick={() => requestAccountAccess(mode === "login" ? "signup" : "login")}
              >
                {mode === "login" ? "Register" : "Log in"}
              </button>
            </p>
            <div className={styles.actions}>
              <button className={styles.quiet} type="button" onClick={onClose}>Continue as guest</button>
              <button className={styles.primary} type="submit" disabled={authBusy || authChecking}>
                {authChecking
                  ? "Checking session…"
                  : authBusy
                    ? "Connecting…"
                    : mode === "login"
                      ? "Continue"
                      : "Review & register"}
              </button>
            </div>
          </form>
        ) : (
          <form className={styles.form} onSubmit={submitTransfer}>
            <p className={styles.transferIntro}>
              This is the only time local guest data can be added to the new account. Future logins always use account data only.
            </p>
            <ul className={styles.summary} aria-label="Guest data found">
              {guestData.labels.map((label: string) => <li key={label}>{label}</li>)}
            </ul>
            <fieldset className={styles.choices}>
              <legend>Create the account with which data?</legend>
              {([
                ["merge", "Bring local data", "Import this guest profile’s decks, settings, draft, and eligible match records into the account."],
                ["fresh", "Start with an empty account", "Keep guest data only in this browser and create a separate account with default data."],
              ] as const).map(([value, title, copy]) => (
                <label className={styles.choice} key={value}>
                  <input
                    type="radio"
                    name="registration-data"
                    value={value}
                    checked={strategy === value}
                    onChange={() => setStrategy(value)}
                  />
                  <span><strong>{title}</strong><span>{copy}</span></span>
                </label>
              ))}
            </fieldset>
            <p className={styles.notice}>
              Your local guest data remains unchanged whichever option you choose.
            </p>
            {authError && <p className={styles.error} role="alert">{authError}</p>}
            <div className={styles.actions}>
              <button className={styles.quiet} type="button" disabled={authBusy} onClick={() => setStep("details")}>Back</button>
              <button className={styles.primary} type="submit" disabled={authBusy}>
                {authBusy ? "Protecting progress…" : "Create account"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

export function GuestAccountPrompt({
  reason,
  onLogin,
  onRegister,
  onDismiss,
}: {
  reason: "deck-saved" | "match-complete";
  onLogin: () => void;
  onRegister: () => void;
  onDismiss: () => void;
}) {
  return (
    <aside className={styles.prompt} role="status" data-ui="guest-account-prompt">
      <strong>{reason === "deck-saved" ? "Deck saved on this device" : "Match complete"}</strong>
      <p>
        {reason === "deck-saved"
          ? "Register to back up this deck and use it on other devices."
          : "Register to protect eligible progress and sync it across devices."}
      </p>
      <div className={styles.promptActions}>
        <button type="button" onClick={onRegister}>Register</button>
        <button type="button" onClick={onLogin}>Log in</button>
        <button type="button" onClick={onDismiss}>Not now</button>
      </div>
    </aside>
  );
}
