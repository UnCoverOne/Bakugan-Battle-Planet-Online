"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { validateDeck, type DeckRecord } from "../../lib/data";
import type { GameCard } from "../../lib/game";
import { useApp } from "../application/AppProvider";
import { notifyAdministratorAiVisibilityChanged } from "../application/useAdministratorAiVisibility";
import {
  ActionButton,
  Field,
  RouteHero,
  StatusChip,
  Surface,
  Tabs,
} from "../design-system/primitives";
import styles from "./AdminScreen.module.css";

type AdminTab = "ai" | "cards" | "ranked" | "users";
type AiDeckItem = { id: string; deck: DeckRecord; enabled: boolean; updatedAt: number };
type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  faction: string;
  createdAt: number;
  updatedAt: number;
  dataUpdatedAt?: number;
  roles: string[];
  banned: boolean;
  bannedAt?: number;
  banReason: string;
  deckCount: number;
  matchCount: number;
};

async function adminRequest(body: Record<string, unknown>) {
  const response = await fetch("/api/admin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Administrator action failed.");
  return result;
}

function useAdminData<T>(section: string, refresh: number) {
  const [state, setState] = useState<{ loading: boolean; data: T | null; error: string }>({
    loading: true,
    data: null,
    error: "",
  });
  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: "" }));
    fetch(`/api/admin?section=${encodeURIComponent(section)}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Administrator data could not be loaded.");
        if (active) setState({ loading: false, data: result as T, error: "" });
      })
      .catch((error) => {
        if (active) setState({ loading: false, data: null, error: error instanceof Error ? error.message : "Administrator data could not be loaded." });
      });
    return () => { active = false; };
  }, [refresh, section]);
  return state;
}

export function AdminScreen() {
  const searchParams = useSearchParams();
  const { authUser } = useApp();
  const requested = searchParams.get("tab");
  const tab: AdminTab = requested === "cards" || requested === "ranked" || requested === "users" ? requested : "ai";
  if (!authUser?.roles?.includes("administrator")) {
    return (
      <div className={styles.route}>
        <Surface className={styles.denied} role="alert">
          <span>!</span>
          <h1>Administrator access required</h1>
          <p>This route is restricted to accounts with the Administrator role.</p>
          <Link href="/">Return Home</Link>
        </Surface>
      </div>
    );
  }
  return (
    <div className={styles.route}>
      <RouteHero
        eyebrow="ADMINISTRATOR"
        title="Control Centre"
        description="Manage AI loadouts, the live card catalogue, public content, and player accounts."
        aside={<StatusChip tone="danger">Restricted</StatusChip>}
      />
      <Tabs className={styles.tabs} label="Administrator sections">
        <Link className={tab === "ai" ? "active" : ""} aria-current={tab === "ai" ? "page" : undefined} href="/admin?tab=ai">AI Management</Link>
        <Link className={tab === "cards" ? "active" : ""} aria-current={tab === "cards" ? "page" : undefined} href="/admin?tab=cards">Card Management</Link>
        <Link className={tab === "ranked" ? "active" : ""} aria-current={tab === "ranked" ? "page" : undefined} href="/admin?tab=ranked">Ranked Play</Link>
        <Link className={tab === "users" ? "active" : ""} aria-current={tab === "users" ? "page" : undefined} href="/admin?tab=users">User Management</Link>
      </Tabs>
      {tab === "ai" && <AiManagement />}
      {tab === "cards" && <CardManagement />}
      {tab === "ranked" && <RankedManagement />}
      {tab === "users" && <UserManagement />}
    </div>
  );
}

type RankedRestriction = { catalogId?: string; constructionIdentity: string; limit: 0 | 1 | 2; reason?: string };
type RankedRulesetAdmin = { version: number; restrictions: RankedRestriction[]; publishedAt: number };
type RankedAdminData = {
  active: RankedRulesetAdmin;
  draft: RankedRulesetAdmin;
  history: RankedRulesetAdmin[];
  indicators: Array<{ firstName: string; secondName: string; seriesCount: number; lastSeen: number; reason: string }>;
  cards: Array<{ catalogId: string; name: string; constructionIdentity: string }>;
};

function RankedManagement() {
  const { notify } = useApp();
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const [restrictions, setRestrictions] = useState<RankedRestriction[]>([]);
  const state = useAdminData<RankedAdminData>("ranked", refresh);
  useEffect(() => {
    if (state.data) setRestrictions(state.data.draft.restrictions.map((item) => ({ ...item })));
  }, [state.data]);
  const restrictionByIdentity = useMemo(() => new Map(restrictions.map((item) => [item.constructionIdentity, item])), [restrictions]);
  const cards = useMemo(() => (state.data?.cards ?? []).filter((card) => `${card.catalogId} ${card.name}`.toLowerCase().includes(query.toLowerCase())).slice(0, 120), [query, state.data?.cards]);
  const update = (card: RankedAdminData["cards"][number], value: string) => {
    const limit = value === "none" ? null : Number(value) as 0 | 1 | 2;
    setRestrictions((current) => {
      const rest = current.filter((item) => item.constructionIdentity !== card.constructionIdentity);
      return limit == null ? rest : [...rest, { catalogId: card.catalogId, constructionIdentity: card.constructionIdentity, limit, reason: "" }];
    });
  };
  const setReason = (identity: string, reason: string) => setRestrictions((current) => current.map((item) => item.constructionIdentity === identity ? { ...item, reason } : item));
  const mutate = async (body: Record<string, unknown>, message: string) => {
    try {
      await adminRequest(body);
      notify(message);
      setRefresh((value) => value + 1);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Ranked rules could not be updated.");
    }
  };
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <div><span>RANKED PLAY</span><h2>Competitive restrictions</h2><p>Competitive decks contain exactly 50 cards. Publish bans and one- or two-copy limits as an immutable version used by every Ranked series.</p></div>
        <StatusChip tone="info">ACTIVE VERSION {state.data?.active.version ?? "…"}</StatusChip>
      </div>
      <AdminState loading={state.loading} error={state.error} label="Ranked rules" />
      <Surface className={styles.rankedToolbar}>
        <Field label="Search cards"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Card name or catalogue ID…" /></Field>
        <div className={styles.rowActions}>
          <button onClick={() => void mutate({ action: "ranked-save-draft", restrictions }, "Ranked restrictions saved as a draft.")}>Save Draft</button>
          <ActionButton onClick={() => {
            if (confirm(`Publish ${restrictions.length} Ranked restriction${restrictions.length === 1 ? "" : "s"} as a new ruleset version?`)) void mutate({ action: "ranked-publish", restrictions }, "A new Ranked ruleset version was published.");
          }}>Publish</ActionButton>
        </div>
      </Surface>
      <Surface className={styles.rankedRules}>
        {cards.map((card) => {
          const restriction = restrictionByIdentity.get(card.constructionIdentity);
          return <div className={styles.rankedRuleRow} key={card.catalogId}>
            <div><strong>{card.name}</strong><small>{card.catalogId}</small></div>
            <select aria-label={`Restriction for ${card.name}`} value={restriction?.limit ?? "none"} onChange={(event) => update(card, event.target.value)}>
              <option value="none">Normal · 3 copies</option><option value="2">Restricted · 2 copies</option><option value="1">Restricted · 1 copy</option><option value="0">Banned</option>
            </select>
            <input aria-label={`Reason for ${card.name}`} disabled={!restriction} value={restriction?.reason ?? ""} onChange={(event) => setReason(card.constructionIdentity, event.target.value)} placeholder="Public reason (optional)" />
          </div>;
        })}
      </Surface>
      <Surface className={styles.rankedHistory}>
        <h3>Suspicious activity indicators</h3>
        <p>Informational only. Ranked play is never blocked or rating-limited automatically.</p>
        {state.data?.indicators.length ? state.data.indicators.map((indicator) => <div key={`${indicator.firstName}:${indicator.secondName}`}>
          <span>{indicator.firstName} ↔ {indicator.secondName}</span>
          <small>{indicator.seriesCount} series · {indicator.reason} · {new Date(indicator.lastSeen).toLocaleString()}</small>
          <StatusChip tone="warning">REVIEW</StatusChip>
        </div>) : <p>No repeated-opponent indicators in the last 24 hours.</p>}
      </Surface>
      {state.data?.history.length ? <Surface className={styles.rankedHistory}>
        <h3>Version history</h3>
        {state.data.history.map((version) => <div key={version.version}>
          <span>Version {version.version}</span><small>{version.restrictions.length} restrictions · {new Date(version.publishedAt).toLocaleString()}</small>
          <button onClick={() => {
            if (confirm(`Republish version ${version.version} as a new active version?`)) void mutate({ action: "ranked-rollback", version: version.version }, `Version ${version.version} was restored as a new Ranked ruleset.`);
          }}>Restore</button>
        </div>)}
      </Surface> : null}
    </section>
  );
}

function AdminState({ loading, error, label }: { loading: boolean; error: string; label: string }) {
  if (loading) return <Surface className={styles.state} role="status">Loading {label}…</Surface>;
  if (error) return <Surface className={styles.state} role="alert">{error}</Surface>;
  return null;
}

function AiManagement() {
  const router = useRouter();
  const { decks: localDecks, setBuilderDeck, notify } = useApp();
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState("");
  const state = useAdminData<{ decks: AiDeckItem[] }>("ai-decks", refresh);
  const visibilityState = useAdminData<{ revealAiCards: boolean }>("ai-visibility", refresh);
  const mutate = useCallback(async (body: Record<string, unknown>, message: string) => {
    try {
      await adminRequest(body);
      notify(message);
      setRefresh((value) => value + 1);
    } catch (error) {
      notify(error instanceof Error ? error.message : "AI deck action failed.");
    }
  }, [notify]);
  const updateAiVisibility = async (enabled: boolean) => {
    try {
      const result = await adminRequest({ action: "ai-visibility", enabled }) as {
        revealAiCards: boolean;
      };
      notifyAdministratorAiVisibilityChanged(result.revealAiCards);
      notify(result.revealAiCards
        ? "Training AI hand and Energy cards will be shown face up."
        : "Training AI hidden cards will use their card backs.");
      setRefresh((value) => value + 1);
    } catch (error) {
      notify(error instanceof Error ? error.message : "AI visibility could not be updated.");
    }
  };
  const add = async () => {
    const deck = localDecks.find((candidate: DeckRecord) => candidate.id === selection);
    if (!deck) return;
    await mutate({ action: "ai-add", deck }, `${deck.name} added to the AI deck pool.`);
    setSelection("");
  };
  const edit = (item: AiDeckItem) => {
    setBuilderDeck({ ...item.deck, cardIds: [...item.deck.cardIds], coreIds: [...item.deck.coreIds], bakuganIds: [...item.deck.bakuganIds], factions: [...item.deck.factions] });
    router.push(`/builder/${encodeURIComponent(`admin-ai:${item.id}`)}?returnTo=${encodeURIComponent("/admin?tab=ai")}`);
  };
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <div><span>AI MANAGEMENT</span><h2>Deck Management</h2><p>Only enabled, valid decks can be selected for Training AI matches.</p></div>
        <div className={styles.addDeck}>
          <Field label="Add one of my decks">
            <select value={selection} onChange={(event) => setSelection(event.target.value)}>
              <option value="">Choose a saved deck…</option>
              {localDecks.map((deck: DeckRecord) => <option value={deck.id} key={deck.id}>{deck.name}{validateDeck(deck).isLegal ? "" : " (invalid)"}</option>)}
            </select>
          </Field>
          <ActionButton disabled={!selection} onClick={add}>Add Deck</ActionButton>
        </div>
      </div>
      <Surface className={styles.aiVisibilityControl}>
        <div className={styles.aiVisibilityCopy}>
          <span>ADMINISTRATOR MATCH TOOLS</span>
          <h3>Reveal Training AI hidden cards</h3>
          <p>Show the faces of the Training AI opponent’s Hand and Energy cards during local AI matches. Online opponents remain hidden.</p>
        </div>
        <label className={`${styles.switch} ${styles.featureSwitch}`}>
          <input
            type="checkbox"
            role="switch"
            aria-label="Reveal Training AI Hand and Energy cards"
            checked={Boolean(visibilityState.data?.revealAiCards)}
            disabled={visibilityState.loading || Boolean(visibilityState.error)}
            onChange={(event) => void updateAiVisibility(event.target.checked)}
          />
          <span>{visibilityState.data?.revealAiCards ? "On" : "Off"}</span>
        </label>
      </Surface>
      <AdminState loading={visibilityState.loading} error={visibilityState.error} label="AI visibility preference" />
      <AdminState loading={state.loading} error={state.error} label="AI decks" />
      <div className={styles.deckRows}>
        {state.data?.decks.map((item) => {
          const report = validateDeck(item.deck);
          return (
            <Surface as="article" className={styles.deckRow} key={item.id}>
              <label className={styles.switch}>
                <input
                  type="checkbox"
                  checked={item.enabled}
                  onChange={(event) => void mutate({ action: "ai-toggle", id: item.id, enabled: event.target.checked }, `${item.deck.name} ${event.target.checked ? "enabled" : "disabled"} for AI selection.`)}
                />
                <span>{item.enabled ? "Enabled" : "Disabled"}</span>
              </label>
              <div><h3>{item.deck.name}</h3><p>{item.deck.factions.join(" · ") || "No factions"}</p></div>
              <StatusChip tone={report.isLegal ? "success" : "danger"}>{report.isLegal ? "Legal" : `${report.issues.length} issues`}</StatusChip>
              <div className={styles.rowActions}>
                <button onClick={() => edit(item)}>Open in Deck Editor</button>
                <button className={styles.danger} onClick={() => {
                  if (confirm(`Delete “${item.deck.name}” from the AI deck pool?`)) {
                    void mutate({ action: "ai-delete", id: item.id }, `${item.deck.name} removed from the AI deck pool.`);
                  }
                }}>Delete</button>
              </div>
            </Surface>
          );
        })}
      </div>
    </section>
  );
}

function CardManagement() {
  const { notify } = useApp();
  const [refresh, setRefresh] = useState(0);
  const state = useAdminData<{ cards: GameCard[] }>("cards", refresh);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("All");
  const [faction, setFaction] = useState("All");
  const [selectedId, setSelectedId] = useState("");
  const [editor, setEditor] = useState("");
  const cards = useMemo(() => (state.data?.cards ?? []).filter((card) => {
    const text = `${card.catalogId} ${card.displayName} ${card.effect}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase()))
      && (type === "All" || card.type === type)
      && (faction === "All" || card.factions.includes(faction as never));
  }), [faction, query, state.data?.cards, type]);
  const selected = state.data?.cards.find((card) => card.catalogId === selectedId);
  useEffect(() => {
    if (selected) setEditor(JSON.stringify(selected, null, 2));
  }, [selected]);
  const save = async () => {
    try {
      const card = JSON.parse(editor);
      await adminRequest({ action: "card-save", card });
      window.dispatchEvent(new Event("bbp-card-overrides-updated"));
      notify(`${card.displayName ?? card.catalogId} updated.`);
      setRefresh((value) => value + 1);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Card update failed.");
    }
  };
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}><div><span>CATALOGUE</span><h2>Card Management</h2><p>Edit card presentation and gameplay properties. Card IDs remain stable so saved decks retain referential integrity.</p></div></div>
      <Surface className={styles.cardToolbar}>
        <Field label="Search cards"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, Card ID, or effect…" /></Field>
        <Field label="Type"><select value={type} onChange={(event) => setType(event.target.value)}><option>All</option><option>Action</option><option>Flip</option><option>Hero</option><option>Evo</option><option>Character</option></select></Field>
        <Field label="Faction"><select value={faction} onChange={(event) => setFaction(event.target.value)}><option>All</option><option>Pyrus</option><option>Aquos</option><option>Darkus</option><option>Haos</option><option>Ventus</option><option>Aurelus</option></select></Field>
      </Surface>
      <AdminState loading={state.loading} error={state.error} label="cards" />
      <div className={styles.cardManagement}>
        <Surface className={styles.cardList}>
          <header><strong>{cards.length} cards</strong><span>Select a card to edit</span></header>
          <div>
            {cards.map((card) => (
              <button className={selectedId === card.catalogId ? styles.selected : ""} onClick={() => setSelectedId(card.catalogId)} key={card.catalogId}>
                <span>{card.catalogId}</span><strong>{card.displayName}</strong><small>{card.factions.join(" · ")} · {card.type}</small>
              </button>
            ))}
          </div>
        </Surface>
        <Surface className={styles.cardEditor}>
          {selected ? (
            <>
              <header><div><span>{selected.catalogId}</span><h3>{selected.displayName}</h3></div><StatusChip>{selected.type}</StatusChip></header>
              <Field label="All card details and properties (JSON)">
                <textarea value={editor} spellCheck={false} onChange={(event) => setEditor(event.target.value)} />
              </Field>
              <p>Arrays such as <code>factions</code>, <code>mechanics</code>, and <code>coreTypes</code> can be edited directly. The immutable <code>id</code> and <code>catalogId</code> are preserved by the server.</p>
              <div className={styles.rowActions}>
                <ActionButton onClick={save}>Save Card</ActionButton>
                <button onClick={() => selected && setEditor(JSON.stringify(selected, null, 2))}>Discard changes</button>
                <button className={styles.danger} onClick={async () => {
                  if (!confirm(`Restore ${selected.displayName} to its repository values?`)) return;
                  try {
                    await adminRequest({ action: "card-reset", catalogId: selected.catalogId });
                    window.dispatchEvent(new Event("bbp-card-overrides-updated"));
                    notify(`${selected.displayName} restored.`);
                    setRefresh((value) => value + 1);
                  } catch (error) { notify(error instanceof Error ? error.message : "Card restore failed."); }
                }}>Restore original</button>
              </div>
            </>
          ) : <div className={styles.emptyEditor}><strong>Select a card</strong><p>Its complete editable record will appear here.</p></div>}
        </Surface>
      </div>
    </section>
  );
}

function UserManagement() {
  const { authUser, notify } = useApp();
  const [refresh, setRefresh] = useState(0);
  const state = useAdminData<{ users: AdminUser[]; roles: string[] }>("users", refresh);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("All");
  const [status, setStatus] = useState("All");
  const [sort, setSort] = useState("Newest");
  const users = useMemo(() => (state.data?.users ?? []).filter((user) => {
    const search = `${user.displayName} ${user.email} ${user.id}`.toLowerCase();
    return (!query || search.includes(query.toLowerCase()))
      && (role === "All" || user.roles.includes(role))
      && (status === "All" || (status === "Banned" ? user.banned : !user.banned));
  }).sort((left, right) => {
    if (sort === "Name") return left.displayName.localeCompare(right.displayName);
    if (sort === "Email") return left.email.localeCompare(right.email);
    if (sort === "Most decks") return right.deckCount - left.deckCount;
    return Number(right.createdAt) - Number(left.createdAt);
  }), [query, role, sort, state.data?.users, status]);
  const mutate = useCallback(async (body: Record<string, unknown>, message: string) => {
    try {
      await adminRequest(body);
      notify(message);
      setRefresh((value) => value + 1);
    } catch (error) { notify(error instanceof Error ? error.message : "Account action failed."); }
  }, [notify]);
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}><div><span>ACCOUNTS</span><h2>User Management</h2><p>Search, sort, filter, assign roles, reset saved data, ban, or remove accounts.</p></div></div>
      <Surface className={styles.userToolbar}>
        <Field label="Search users"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, email, or user ID…" /></Field>
        <Field label="Role"><select value={role} onChange={(event) => setRole(event.target.value)}><option>All</option><option value="administrator">Administrator</option><option value="moderator">Moderator</option></select></Field>
        <Field label="Status"><select value={status} onChange={(event) => setStatus(event.target.value)}><option>All</option><option>Active</option><option>Banned</option></select></Field>
        <Field label="Sort"><select value={sort} onChange={(event) => setSort(event.target.value)}><option>Newest</option><option>Name</option><option>Email</option><option>Most decks</option></select></Field>
      </Surface>
      <AdminState loading={state.loading} error={state.error} label="users" />
      <div className={styles.userRows}>
        {users.map((user) => {
          const protectedUser = user.email.toLowerCase() === "uncover250@gmail.com";
          return (
            <Surface as="article" className={styles.userRow} key={user.id}>
              <div className={styles.userIdentity}>
                <span>{user.displayName.slice(0, 2).toUpperCase()}</span>
                <div><h3>{user.displayName}</h3><p>{user.email}</p><small>{user.faction} · joined {new Date(user.createdAt).toLocaleDateString()}</small></div>
              </div>
              <div className={styles.userCounts}><span><strong>{user.deckCount}</strong> decks</span><span><strong>{user.matchCount}</strong> matches</span></div>
              <div className={styles.roles}>
                {(state.data?.roles ?? []).map((candidate) => (
                  <label key={candidate}>
                    <input
                      type="checkbox"
                      checked={user.roles.includes(candidate)}
                      disabled={protectedUser || user.id === authUser?.id && candidate === "administrator"}
                      onChange={(event) => void mutate({ action: "set-role", userId: user.id, role: candidate, enabled: event.target.checked }, `${user.displayName}'s roles updated.`)}
                    />
                    {candidate === "administrator" ? "Administrator" : "Moderator"}
                  </label>
                ))}
              </div>
              <div className={styles.userStatus}>
                <StatusChip tone={user.banned ? "danger" : "success"}>{user.banned ? "Banned" : "Active"}</StatusChip>
                {user.banReason && <small>{user.banReason}</small>}
              </div>
              <div className={styles.userActions}>
                <select aria-label={`Reset data for ${user.displayName}`} defaultValue="" disabled={protectedUser} onChange={(event) => {
                  const scope = event.target.value;
                  event.target.value = "";
                  if (scope && confirm(`Reset ${scope === "all" ? "all synced account data" : scope} for ${user.displayName}?`)) {
                    void mutate({ action: "reset-user-data", userId: user.id, scope }, `${user.displayName}'s ${scope} data reset.`);
                  }
                }}>
                  <option value="" disabled>Reset data…</option>
                  <option value="decks">Decks and draft</option>
                  <option value="history">Match history</option>
                  <option value="settings">Settings</option>
                  <option value="profile">Local profile</option>
                  <option value="all">All synced data</option>
                </select>
                {user.banned ? (
                  <button disabled={protectedUser} onClick={() => void mutate({ action: "unban-user", userId: user.id }, `${user.displayName} unbanned.`)}>Unban</button>
                ) : (
                  <button disabled={protectedUser} onClick={() => {
                    const reason = prompt(`Reason for banning ${user.displayName}:`, "");
                    if (reason !== null) void mutate({ action: "ban-user", userId: user.id, reason }, `${user.displayName} banned.`);
                  }}>Ban</button>
                )}
                <button className={styles.danger} disabled={protectedUser} onClick={() => {
                  if (confirm(`Permanently delete ${user.displayName} (${user.email}) and all account data?`)) {
                    void mutate({ action: "delete-user", userId: user.id }, `${user.displayName}'s account deleted.`);
                  }
                }}>Delete Account</button>
              </div>
            </Surface>
          );
        })}
      </div>
    </section>
  );
}
