"use client";

import { OriginalImage } from "@/components/media/OriginalImage";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isCompendiumSectionChange } from "../../lib/compendium-navigation";
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { VERSION_MISMATCH_EVENT } from "../AssetFreshness";
import { SystemState, VersionMismatchScreen } from "./SystemState";
import {
  AccountAccessModal,
  GuestAccountPrompt,
} from "./AccountAccessModal";
import { useAppFields } from "./AppProvider";
import { SocialDrawer, SocialProvider } from "../social/SocialProvider";
import { PrototypeNavigation } from "../navigation/PrototypeNavigation";

const MusicLayer = lazy(() => import("./MusicLayer").then((module) => ({ default: module.MusicLayer })));

const FeedbackReportsDialog = lazy(() => import("./FeedbackReportsDialog"));

import { activeBuilder, builderNavigationHref, builderScope, subscribeBuilder } from "../../lib/builder-session";

export function AppShell({ children }) {
  const pathname = usePathname();
  const focusPathRef = useRef(null);
  const {
    ready,
    decks,
    route,
    authUser,
    authChecking,
    accountDataReady,
    authError,
    storageHealth,
    retryCloudLoad,
    toast,
    accountPrompt,
    dismissAccountPrompt,
    accountAccessMode,
    requestAccountAccess,
    closeAccountAccess,
    signOutAccount,
  } = useAppFields([
    "ready", "decks", "route", "authUser", "authChecking", "accountDataReady",
    "authError", "storageHealth", "retryCloudLoad", "toast", "accountPrompt",
    "dismissAccountPrompt", "accountAccessMode", "requestAccountAccess",
    "closeAccountAccess", "signOutAccount",
  ]);
  const resumeScope = builderScope(authUser?.id);
  const resumeId = useSyncExternalStore(subscribeBuilder, () => activeBuilder(resumeScope), () => null);
  const decksHref = builderNavigationHref(resumeId, decks);
  const immersiveMatch = pathname === "/play/match";
  const redesignHome = pathname === "/";
  const homeRoute = pathname === "/" || pathname.startsWith("/dashboard");
  const secondaryRoute = !immersiveMatch && !homeRoute;
  const mainRef = useRef(null);
  const [isOnline, setIsOnline] = useState(true);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [versionMismatch, setVersionMismatch] = useState(false);

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

  useEffect(() => {
    const showMismatch = () => setVersionMismatch(true);
    window.addEventListener(VERSION_MISMATCH_EVENT, showMismatch);
    return () =>
      window.removeEventListener(VERSION_MISMATCH_EVENT, showMismatch);
  }, []);

  useEffect(() => {
    const internalSectionChange = isCompendiumSectionChange(focusPathRef.current, pathname);
    focusPathRef.current = pathname;
    if (immersiveMatch || !ready || internalSectionChange) return;
    const frame = window.requestAnimationFrame(() => {
      const target = mainRef.current?.querySelector("h1") ?? mainRef.current;
      target?.setAttribute("tabindex", "-1");
      target?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [immersiveMatch, pathname, ready]);

  const requestLogout = async () => {
    if (await signOutAccount()) return;
    if (
      window.confirm(
        "Cloud save could not finish. Log out anyway and keep the unsynced account recovery copy in this browser?",
      )
    ) {
      await signOutAccount({ retainUnsynced: true });
    }
  };

  if ((!ready || authChecking) && !redesignHome) return <BootScreen />;
  if (authUser && !accountDataReady && !redesignHome) {
    return (
      <AccountDataScreen
        error={authError}
        onRetry={() => void retryCloudLoad()}
        onLogout={() => void requestLogout()}
      />
    );
  }
  const title =
    TITLES[pathname.split("/").filter(Boolean)[0] ?? "dashboard"] ??
    TITLES[route] ??
    "Bakugan Battle Planet Online";
  return (
    <SocialProvider>
      {!redesignHome && <Suspense fallback={null}><MusicLayer /></Suspense>}
      <div
        className={`app-shell ${immersiveMatch ? "immersive-match" : ""} ${secondaryRoute ? "secondary-route" : ""} ${redesignHome ? "home-rebuild-shell" : ""} ${!immersiveMatch ? "prototype-nav-shell" : ""}`}
      >
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      {!immersiveMatch && (
        <PrototypeNavigation
          authUser={authUser}
          decksHref={decksHref}
          requestAccountAccess={requestAccountAccess}
          onLogout={requestLogout}
          onFeedback={() => setFeedbackOpen(true)}
          busy={!ready || authChecking || (Boolean(authUser) && !accountDataReady)}
        />
      )}
      {!immersiveMatch && !redesignHome && !isOnline && (
        <div className="offline-banner" role="status">
          <strong>Offline.</strong>{" "}
          {authUser
            ? "The loaded account session remains available; cloud writes will retry when the connection returns."
            : "Device-local features remain available; cloud services and public updates are unavailable."}
        </div>
      )}
      {!immersiveMatch && !redesignHome && !authUser && storageHealth.status === "error" && (
        <div className="storage-error-banner" role="alert">
          {storageHealth.message}
        </div>
      )}
      <div className="route-announcer" aria-live="polite" aria-atomic="true">
        {title}
      </div>
      <main id="main-content" className="main-stage" ref={mainRef}>
        {children}
      </main>
      {accountPrompt && !authUser && (
        <GuestAccountPrompt
          reason={accountPrompt}
          onLogin={() => {
            dismissAccountPrompt();
            requestAccountAccess("login");
          }}
          onRegister={() => {
            dismissAccountPrompt();
            requestAccountAccess("signup");
          }}
          onDismiss={dismissAccountPrompt}
        />
      )}
      {accountAccessMode && !authUser && (
        <AccountAccessModal
          key={accountAccessMode}
          mode={accountAccessMode}
          onClose={closeAccountAccess}
        />
      )}
      {toast && (
        <div key={toast} className="toast" role="status">
          {toast}
        </div>
      )}
      {feedbackOpen && !immersiveMatch && (
        <Suspense fallback={null}>
          <FeedbackReportsDialog
            signedIn={Boolean(authUser)}
            onSignIn={() => { setFeedbackOpen(false); requestAccountAccess("login"); }}
            onClose={() => {
              setFeedbackOpen(false);

            }}
          />
        </Suspense>
      )}
      {versionMismatch && (
        <VersionMismatchScreen onRefresh={() => window.location.reload()} />
      )}
      <SocialDrawer />
      </div>
    </SocialProvider>
  );
}

function AccountDataScreen({ error, onRetry, onLogout }) {
  return (
    <main className="boot-screen">
      <SystemState
        tone={error ? "error" : "loading"}
        eyebrow="Account data"
        title={error ? "Cloud data could not be loaded" : "Loading account data"}
        message={
          error ||
          "Your local guest data is isolated while the signed-in account snapshot loads."
        }
        actions={
          error ? (
            <>
              <button type="button" onClick={onRetry}>Try again</button>
              <button type="button" onClick={onLogout}>Log out</button>
            </>
          ) : undefined
        }
      />
    </main>
  );
}

function BootScreen() {
  return (
    <main className="boot-screen">
      <OriginalImage src="/assets/logo.png" alt="Bakugan Battle Planet" />
      <span className="pulse" />
      <h1>LOADING BRAWLER DATA</h1>
      <p>Checking the session before selecting local or account storage…</p>
    </main>
  );
}
