"use client";

import Link from "next/link";
import { useAppFields } from "../application/AppProvider";

export function BlankDashboardScreen() {
  const { decks, history, authUser, match, accountMatchSessions, requestAccountAccess } = useAppFields([
    "decks", "history", "authUser", "match", "accountMatchSessions", "requestAccountAccess",
  ]);
  return (
    <div className="blank-home">
      <h1>Home</h1>
      <p>Unstyled frontend development baseline. Game functions remain available through the links below.</p>
      <nav aria-label="Quick links">
        <Link href="/play">Play</Link>
        <Link href="/decks">Decks</Link>
        <Link href="/collection">Collection</Link>
        <Link href="/compendium">Compendium</Link>
        <Link href="/leaderboard">Leaderboard</Link>
        <Link href="/settings">Settings</Link>
      </nav>
      <section aria-label="Stored data">
        <h2>Your data</h2>
        <p>Account: {authUser ? "Signed in" : "Guest"}</p>
        <p>Saved decks: {decks?.length ?? 0}</p>
        <p>Match records: {history?.length ?? 0}</p>
        <p>Current match: {match ? "Available" : "None"}</p>
        <p>Account match sessions: {accountMatchSessions?.length ?? 0}</p>
      </section>
      {!authUser && <section>
        <h2>Account</h2>
        <button type="button" onClick={() => requestAccountAccess("login")}>Log in</button>
        <button type="button" onClick={() => requestAccountAccess("signup")}>Register</button>
      </section>}
    </div>
  );
}
