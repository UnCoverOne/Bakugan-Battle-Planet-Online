"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  accountIntentCopy,
  readAccountIntent,
  rememberAccountIntent,
  type AccountIntentReason,
} from "../../lib/account-intent";
import { useApp } from "../application/AppProvider";

const BENEFITS = [
  ["★", "Unlock achievements", "Turn completed local milestones into permanent achievements and profile rewards."],
  ["◇", "Publish Public decks", "Share legal strategies under your permanent Brawler name."],
  ["●", "Build your profile", "Choose an avatar, title and cover, then showcase your favourite accomplishments."],
  ["☁", "Protect progress", "Keep decks, settings and eligible records synced across your devices."],
] as const;

export function GuestAccountScreen() {
  const router = useRouter();
  const {
    authUser,
    accountDataReady,
    guestData,
    requestAccountAccess,
  } = useApp();
  const intent = useMemo(() => readAccountIntent(), []);
  const reason = (intent?.reason ?? "generic") as AccountIntentReason;
  const copy = accountIntentCopy(reason);

  useEffect(() => {
    if (authUser && accountDataReady) router.replace("/profile");
  }, [accountDataReady, authUser, router]);

  const open = (mode: "login" | "signup") => {
    rememberAccountIntent(reason, {
      deckId: intent?.deckId,
      returnTo: intent?.returnTo ?? "/profile",
    });
    requestAccountAccess(mode);
  };

  return (
    <main className="account-gateway-route">
      <section className="account-gateway-card">
        <header className="account-gateway-hero">
          <span className="account-gateway-eyebrow">{copy.eyebrow}</span>
          <h1>{copy.title}</h1>
          <p>{copy.copy}</p>
        </header>

        <div className="account-gateway-grid">
          {BENEFITS.map(([icon, title, description]) => (
            <article className="account-gateway-benefit" key={title}>
              <span aria-hidden="true">{icon}</span>
              <strong>{title}</strong>
              <p>{description}</p>
            </article>
          ))}
        </div>

        <footer className="account-gateway-footer">
          <div className="account-gateway-local">
            <strong>Your guest progress stays safe on this device.</strong>
            <span>
              {guestData.hasMeaningfulData
                ? guestData.labels.join(" · ")
                : "Start playing or building now; registration is not required to try the simulator."}
            </span>
          </div>
          <div className="account-gateway-actions">
            <button type="button" onClick={() => open("signup")}>Create Account</button>
            <button type="button" onClick={() => open("login")}>Log In</button>
          </div>
        </footer>
      </section>
    </main>
  );
}
