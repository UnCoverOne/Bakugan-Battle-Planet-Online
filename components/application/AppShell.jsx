"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { VERSION_MISMATCH_EVENT } from "../AssetFreshness";
import { SystemState, VersionMismatchScreen } from "./SystemState";
import { AccountAccessModal, GuestAccountPrompt } from "./AccountAccessModal";
import { useAppFields } from "./AppProvider";
import { SocialProvider, SocialDrawer } from "../social/SocialProvider";
import { SiteNavigation } from "./SiteNavigation";
import { MusicLayer } from "./MusicLayer";

export function AppShell({ children }) {
  const pathname = usePathname();
  const {
    ready, authChecking, authUser, accountDataReady, authError,
    retryCloudLoad, signOutAccount, accountPrompt, dismissAccountPrompt,
    accountAccessMode, requestAccountAccess, closeAccountAccess,
    toast, match, online, matchCapability, matchControllerId,
    resumeCurrentMatch, resumingCurrentMatch, accountMatchSessions,
    resumeAccountMatch, resumingMatchCode,
  } = useAppFields([
    "ready", "authChecking", "authUser", "accountDataReady", "authError",
    "retryCloudLoad", "signOutAccount", "accountPrompt", "dismissAccountPrompt",
    "accountAccessMode", "requestAccountAccess", "closeAccountAccess",
    "toast", "match", "online", "matchCapability", "matchControllerId",
    "resumeCurrentMatch", "resumingCurrentMatch", "accountMatchSessions",
    "resumeAccountMatch", "resumingMatchCode",
  ]);
  const [versionMismatch, setVersionMismatch] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    const show = () => setVersionMismatch(true);
    window.addEventListener(VERSION_MISMATCH_EVENT, show);
    return () => window.removeEventListener(VERSION_MISMATCH_EVENT, show);
  }, []);
  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const logout = async () => {
    if (await signOutAccount()) return;
    if (window.confirm("Cloud save did not finish. Sign out and retain the recovery copy in this browser?")) {
      await signOutAccount({ retainUnsynced: true });
    }
  };
  if (!ready || authChecking) return <main><h1>Loading</h1><p>Preparing your data.</p></main>;
  if (authUser && !accountDataReady) return (
    <main>
      <SystemState tone={authError ? "error" : "loading"}
        eyebrow="Account data"
        title={authError ? "Account data unavailable" : "Loading account data"}
        message={authError || "Your guest data remains separate while account data loads."}
        actions={authError ? <>
          <button onClick={() => void retryCloudLoad()}>Retry</button>
          <button onClick={() => void logout()}>Sign out</button>
        </> : undefined}
      />
    </main>
  );
  const immersiveMatch = pathname === "/play/match";
  const homePage = pathname === "/";
  const canResumeLocalMatch = Boolean(match && (!online || (matchCapability && matchControllerId)));
  return (
    <SocialProvider>
      <MusicLayer />
      <div className={immersiveMatch ? "blank-shell immersive-shell" : "blank-shell"}>
        <a className="skip-link" href="#main-content">Skip to content</a>
        {!immersiveMatch && <SiteNavigation onLogout={logout} />}
        {!immersiveMatch && !homePage && canResumeLocalMatch && (
          <button type="button" disabled={resumingCurrentMatch} onClick={() => void resumeCurrentMatch()}>
            {resumingCurrentMatch ? "Resuming match…" : "Resume current match"}
          </button>
        )}
        {!immersiveMatch && !homePage && accountMatchSessions?.map((session) => (
          <button key={session.code + ":" + session.playerId} type="button"
            disabled={resumingMatchCode === session.code}
            onClick={() => void resumeAccountMatch(session)}>
            {resumingMatchCode === session.code ? "Resuming…" : "Resume match " + session.code}
          </button>
        ))}
        {!isOnline && <p role="status">Offline: network features are unavailable.</p>}
        <main id="main-content">{children}</main>
        {accountPrompt && !authUser && <GuestAccountPrompt reason={accountPrompt}
          onLogin={() => { dismissAccountPrompt(); requestAccountAccess("login"); }}
          onRegister={() => { dismissAccountPrompt(); requestAccountAccess("signup"); }}
          onDismiss={dismissAccountPrompt} />}
        {accountAccessMode && !authUser && <AccountAccessModal key={accountAccessMode}
          mode={accountAccessMode} onClose={closeAccountAccess} />}
        {toast && <p role="status">{toast}</p>}
        {versionMismatch && <VersionMismatchScreen onRefresh={() => window.location.reload()} />}
        <SocialDrawer />
      </div>
    </SocialProvider>
  );
}
