"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { achievementsFor } from "../../lib/achievements";
import { BAKUGAN, validateDeck, type DeckRecord } from "../../lib/data";
import { deckSetName } from "../../lib/deck-set";
import { cardArtSource } from "../../lib/content/card-art";
import { useApp } from "../application/AppProvider";
import { SystemState } from "../application/SystemState";
import { copyText, formatTimestamp } from "../application/ui";
import {
  ActionButton,
  Field,
  RouteHero,
  StatusChip,
  Surface,
  Tabs,
} from "../design-system/primitives";
import { AchievementsScreen } from "./AchievementsScreen";
import styles from "./ProfileScreen.module.css";

type ProfileSection = "overview" | "achievements" | "records";

const resultTone = (result: string) =>
  result === "Victor" ? "success" : result === "Defeat" ? "danger" : "neutral";

export function ProfileScreen({ segments = [] }: { segments?: string[] }) {
  const router = useRouter();
  const {
    profile,
    setProfile,
    history,
    decks,
    selectedDeck,
    authUser,
    syncStatus,
    storageHealth,
    saveAccountProfile,
    notify,
    replay,
    setReplay,
    replayIndex,
    setReplayIndex,
  } = useApp();
  const section: ProfileSection =
    segments[0] === "achievements"
      ? "achievements"
      : segments[0] === "records"
        ? "records"
        : "overview";
  const recordId =
    section === "records" ? decodeURIComponent(segments[1] ?? "") : "";
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const [draftName, setDraftName] = useState(profile.name);
  const [draftFaction, setDraftFaction] = useState(profile.faction);
  const [recordFilter, setRecordFilter] = useState("all");
  const achievements = achievementsFor(decks, history);
  const wins = history.filter((item: any) => item.result === "Victor").length;
  const losses = history.filter((item: any) => item.result === "Defeat").length;
  const completed = history.filter(
    (item: any) => !/disconnect|abandon/i.test(`${item.reason ?? ""}`),
  ).length;
  const publicDecks = decks.filter(
    (deck: DeckRecord) => deck.visibility === "Public",
  );

  useEffect(() => {
    if (!recordId) return;
    const record = history.find((item: any) => item.id === recordId);
    if (!record) return;
    setReplay(record);
    setReplayIndex(Math.max(0, record.log.length - 1));
  }, [history, recordId, setReplay, setReplayIndex]);

  const activeRecord = recordId
    ? (history.find((item: any) => item.id === recordId) ?? replay)
    : null;

  if (section === "achievements") {
    return (
      <AchievementsScreen
        achievements={achievements}
        view={segments[1]}
      />
    );
  }

  const saveProfile = async () => {
    const nextName = draftName.trim().replace(/\s+/g, " ") || profile.name;
    setSaving(true);
    setProfile({ ...profile, name: nextName, faction: draftFaction });
    try {
      await saveAccountProfile();
      setSaved("Profile saved");
      setEditing(false);
      window.setTimeout(() => setSaved(""), 2400);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not save profile.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.route}>
      <RouteHero
        className={styles.hero}
        eyebrow="Brawler profile"
        title={profile.name}
        description={`${profile.faction} Brawler · ${authUser ? "Cloud account" : "Device-local profile"}`}
        actions={
          section === "overview" && (
            <>
              <ActionButton
                tone="secondary"
                onClick={() => {
                  setDraftName(profile.name);
                  setDraftFaction(profile.faction);
                  setEditing(true);
                }}
              >
                Edit identity
              </ActionButton>
              <Link className={styles.textAction} href="/play">
                Play a match
              </Link>
            </>
          )
        }
        aside={
          <div
            className={`${styles.avatar} ${styles[`faction_${profile.faction.toLowerCase()}`]}`}
          >
            <span>{profile.name.slice(0, 2).toUpperCase()}</span>
            <small>{profile.faction}</small>
          </div>
        }
      />
      <Tabs label="Profile sections" className={styles.tabs}>
        <Link
          aria-current={section === "overview" ? "page" : undefined}
          className={section === "overview" ? "active" : ""}
          href="/profile"
        >
          Overview
        </Link>
        <Link
          aria-current={section === "achievements" ? "page" : undefined}
          className={section === "achievements" ? "active" : ""}
          href="/profile/achievements"
        >
          Achievements
        </Link>
        <Link
          aria-current={section === "records" ? "page" : undefined}
          className={section === "records" ? "active" : ""}
          href="/profile/records"
        >
          Match records
        </Link>
      </Tabs>
      <div className={styles.saveAnnouncement} role="status" aria-live="polite">
        {saved}
      </div>

      {section === "overview" && (
        <Overview
          history={history}
          publicDecks={publicDecks}
          selectedDeck={selectedDeck}
          wins={wins}
          losses={losses}
          completed={completed}
          authUser={authUser}
          syncStatus={syncStatus}
          storageHealth={storageHealth}
        />
      )}
      {section === "records" && (
        <RecordsPanel
          history={history}
          activeRecord={activeRecord}
          replayIndex={replayIndex}
          setReplayIndex={setReplayIndex}
          filter={recordFilter}
          setFilter={setRecordFilter}
          router={router}
        />
      )}

      {editing && (
        <div
          className={styles.backdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving)
              setEditing(false);
          }}
        >
          <Surface
            className={styles.editDialog}
            elevation="overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-profile-title"
          >
            <div>
              <StatusChip tone="info">Identity</StatusChip>
              <h2 id="edit-profile-title">Edit profile</h2>
              <p>
                Identity changes are saved explicitly. Public decks continue to
                retain their original creator attribution.
              </p>
            </div>
            <Field label="Display name" hint="1–20 visible characters.">
              <input
                value={draftName}
                maxLength={20}
                onChange={(event) => setDraftName(event.target.value)}
              />
            </Field>
            <Field label="Preferred faction">
              <select
                value={draftFaction}
                onChange={(event) => setDraftFaction(event.target.value)}
              >
                {["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"].map(
                  (faction) => (
                    <option key={faction}>{faction}</option>
                  ),
                )}
              </select>
            </Field>
            <div className={styles.dialogActions}>
              <ActionButton
                tone="secondary"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Cancel
              </ActionButton>
              <ActionButton
                onClick={() => void saveProfile()}
                disabled={saving || !draftName.trim()}
              >
                {saving ? "Saving…" : "Save profile"}
              </ActionButton>
            </div>
          </Surface>
        </div>
      )}
    </div>
  );
}

function Overview({
  history,
  publicDecks,
  selectedDeck,
  wins,
  losses,
  completed,
  authUser,
  syncStatus,
  storageHealth,
}: any) {
  const recent = history.slice(0, 5);
  const completionRate = history.length
    ? Math.round((completed / history.length) * 100)
    : 0;
  return (
    <div className={styles.overviewGrid}>
      <section className={styles.primaryColumn}>
        <Surface className={styles.metricsPanel}>
          <div className={styles.panelHeading}>
            <div>
              <span>Reliable record</span>
              <h2>Match statistics</h2>
            </div>
            <StatusChip tone={history.length ? "info" : "neutral"}>
              {history.length ? `${history.length} recorded` : "No history yet"}
            </StatusChip>
          </div>
          <div className={styles.metrics}>
            <Metric label="Matches" value={history.length} />
            <Metric label="Wins" value={wins} />
            <Metric label="Losses" value={losses} />
            <Metric label="Completion" value={`${completionRate}%`} />
          </div>
          <p className={styles.dataNote}>
            Statistics use completed match records stored by this client. They
            do not infer rank, streaks, or achievements from missing history.
          </p>
        </Surface>

        <Surface className={styles.recentPanel}>
          <div className={styles.panelHeading}>
            <div>
              <span>Recent activity</span>
              <h2>Recent matches</h2>
            </div>
            <Link href="/profile/records">Open archive</Link>
          </div>
          {recent.length ? (
            <div className={styles.matchList}>
              {recent.map((item: any) => (
                <Link
                  href={`/profile/records/${encodeURIComponent(item.id)}`}
                  className={styles.matchRow}
                  key={item.id}
                >
                  <StatusChip tone={resultTone(item.result)}>
                    {item.result}
                  </StatusChip>
                  <div>
                    <strong>{item.opponent}</strong>
                    <span>
                      {item.mode ?? "Legacy"} ·{" "}
                      {(item.format ?? "Unknown").toUpperCase()}
                    </span>
                  </div>
                  <span>{item.deckName ?? "Deck not recorded"}</span>
                  <small>{formatTimestamp(item.at)}</small>
                </Link>
              ))}
            </div>
          ) : (
            <SystemState
              compact
              tone="empty"
              title="No matches recorded"
              message="Your history begins when a training or online match reaches a recorded result."
              actions={<Link href="/play">Play a match</Link>}
            />
          )}
        </Surface>
      </section>

      <aside className={styles.secondaryColumn}>
        <Surface className={styles.deckShowcase}>
          <div className={styles.panelHeading}>
            <div>
              <span>Public showcase</span>
              <h2>
                {publicDecks.length} published deck
                {publicDecks.length === 1 ? "" : "s"}
              </h2>
            </div>
            <Link href="/decks/public">Discovery</Link>
          </div>
          {publicDecks.length ? (
            publicDecks.slice(0, 3).map((deck: DeckRecord) => (
              <Link
                className={styles.deckRow}
                href={`/decks/public/${encodeURIComponent(deck.id)}`}
                key={deck.id}
              >
                <CharacterStack deck={deck} />
                <div>
                  <strong>{deck.name}</strong>
                  <span>{deck.factions.join(" • ") || "Team incomplete"}</span>
                  <small>{deckSetName(deck)}</small>
                </div>
                <StatusChip
                  tone={validateDeck(deck).isLegal ? "success" : "danger"}
                >
                  {validateDeck(deck).isLegal ? "Legal" : "Draft"}
                </StatusChip>
              </Link>
            ))
          ) : (
            <SystemState
              compact
              tone="empty"
              title="No public decks"
              message="Publish a legal deck from the Deck Builder to add it to your showcase."
              actions={<Link href="/decks">Open My Decks</Link>}
            />
          )}
        </Surface>

        <Surface className={styles.dataStatus}>
          <div className={styles.panelHeading}>
            <div>
              <span>Owner-only</span>
              <h2>Data status</h2>
            </div>
            <StatusChip
              tone={
                authUser
                  ? syncStatus === "synced"
                    ? "success"
                    : syncStatus === "error"
                      ? "danger"
                      : "info"
                  : storageHealth.status === "error"
                    ? "danger"
                    : "success"
              }
            >
              {authUser ? syncStatus : storageHealth.status}
            </StatusChip>
          </div>
          <dl>
            <div>
              <dt>Identity</dt>
              <dd>{authUser ? authUser.email : "Device-local"}</dd>
            </div>
            <div>
              <dt>Selected deck</dt>
              <dd>{selectedDeck?.name ?? "None selected"}</dd>
            </div>
            <div>
              <dt>Storage</dt>
              <dd>{authUser ? "Cloud + device" : "This browser"}</dd>
            </div>
          </dl>
          <Link href="/settings">Manage data and privacy</Link>
        </Surface>
      </aside>
    </div>
  );
}

function CharacterStack({ deck }: { deck: DeckRecord }) {
  const characters = deck.bakuganIds
    .map((id) => BAKUGAN.find((item) => item.id === id))
    .filter(Boolean);
  return (
    <div
      className={styles.characterStack}
      aria-label={`${characters.length} Character Cards`}
    >
      {characters.map((character) => (
        <img
          key={character!.id}
          src={cardArtSource(character!.character, "thumbnail")}
          alt=""
          width="48"
          height="67"
          loading="lazy"
        />
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RecordsPanel({
  history,
  activeRecord,
  replayIndex,
  setReplayIndex,
  filter,
  setFilter,
  router,
}: any) {
  if (activeRecord) {
    const event = activeRecord.log[replayIndex];
    return (
      <section className={styles.recordDetail}>
        <header>
          <ActionButton
            tone="quiet"
            onClick={() => router.push("/profile/records")}
          >
            ← Match records
          </ActionButton>
          <div>
            <span>Record {activeRecord.id}</span>
            <h2>
              {activeRecord.result} vs {activeRecord.opponent}
            </h2>
            <p>
              {formatTimestamp(activeRecord.at)} ·{" "}
              {(activeRecord.format ?? "unknown").toUpperCase()} ·{" "}
              {activeRecord.mode ?? "legacy"}
            </p>
          </div>
          <ActionButton
            tone="secondary"
            onClick={() => void copyText(window.location.href)}
          >
            Copy link
          </ActionButton>
        </header>
        <div className={styles.recordLayout}>
          <Surface
            as="aside"
            className={styles.eventList}
            aria-label="Match events"
          >
            {activeRecord.log.map((item: any, index: number) => (
              <button
                className={index === replayIndex ? styles.active : ""}
                key={item.id}
                onClick={() => setReplayIndex(index)}
              >
                <span>{index + 1}</span>
                <div>
                  <strong>{item.kind}</strong>
                  <p>{item.message}</p>
                </div>
              </button>
            ))}
          </Surface>
          <Surface className={styles.eventFocus}>
            <StatusChip tone={event?.kind === "random" ? "warning" : "info"}>
              {event?.kind?.toUpperCase() ?? "EVENT"}
            </StatusChip>
            <h2>{event?.message ?? "No event selected"}</h2>
            <p>{event ? new Date(event.at ?? 0).toLocaleTimeString() : ""}</p>
            <div>
              <button
                onClick={() => setReplayIndex(Math.max(0, replayIndex - 1))}
              >
                ← Previous
              </button>
              <span>
                {replayIndex + 1} / {activeRecord.log.length}
              </span>
              <button
                onClick={() =>
                  setReplayIndex(
                    Math.min(activeRecord.log.length - 1, replayIndex + 1),
                  )
                }
              >
                Next →
              </button>
            </div>
          </Surface>
          <Surface as="aside" className={styles.recordMetadata}>
            <h2>Match details</h2>
            <dl>
              <div>
                <dt>Result</dt>
                <dd>{activeRecord.result}</dd>
              </div>
              <div>
                <dt>Score</dt>
                <dd>{activeRecord.score}</dd>
              </div>
              <div>
                <dt>Reason</dt>
                <dd>{activeRecord.reason}</dd>
              </div>
              <div>
                <dt>Events</dt>
                <dd>{activeRecord.log.length}</dd>
              </div>
            </dl>
          </Surface>
        </div>
      </section>
    );
  }
  const visible = history.filter(
    (item: any) =>
      filter === "all" ||
      item.result.toLowerCase() === filter ||
      item.mode === filter ||
      item.format === filter,
  );
  return (
    <section className={styles.section}>
      <header className={styles.sectionToolbar}>
        <div>
          <span>Match archive</span>
          <h2>Recorded matches</h2>
        </div>
        <Field label="Filter">
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All records</option>
            <option value="victor">Victories</option>
            <option value="defeat">Defeats</option>
            <option value="training">Training</option>
            <option value="online">Online</option>
            <option value="bo1">Best of one</option>
            <option value="bo3">Best of three</option>
          </select>
        </Field>
      </header>
      {visible.length ? (
        <Surface className={styles.recordTable}>
          {visible.map((item: any) => (
            <button
              key={item.id}
              onClick={() =>
                router.push(`/profile/records/${encodeURIComponent(item.id)}`)
              }
            >
              <StatusChip tone={resultTone(item.result)}>
                {item.result}
              </StatusChip>
              <strong>{item.opponent}</strong>
              <span>{item.score}</span>
              <span>{item.mode ?? "legacy"}</span>
              <small>{formatTimestamp(item.at)}</small>
              <i>Open →</i>
            </button>
          ))}
        </Surface>
      ) : (
        <SystemState
          compact
          tone="empty"
          title="No matching records"
          message="Complete a training or online match, or clear the current filter."
          actions={<Link href="/play">Play a match</Link>}
        />
      )}
    </section>
  );
}
