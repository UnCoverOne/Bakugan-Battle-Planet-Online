import type { AccountDatabase, AccountUser } from "./account-server";
import { CARDS } from "./data";
import type { DeckRestriction } from "./deck-validation";
import { eloTransfer, rankForBp, RANKED_STARTING_BP, type RankedRuleset, type RankedSettlement } from "./ranked";

let rankedSchemaReady = false;

export async function ensureRankedSchema(db: AccountDatabase) {
  if (rankedSchemaReady) return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS ranked_ratings (user_id TEXT PRIMARY KEY NOT NULL, bp INTEGER NOT NULL DEFAULT 1000, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, last_achieved_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)"),
    db.prepare("CREATE INDEX IF NOT EXISTS ranked_ratings_leaderboard_idx ON ranked_ratings(bp DESC, wins DESC, last_achieved_at ASC)"),
    db.prepare("CREATE TABLE IF NOT EXISTS ranked_series (series_id TEXT PRIMARY KEY NOT NULL, ruleset_version INTEGER NOT NULL, player_one_user_id TEXT NOT NULL, player_two_user_id TEXT NOT NULL, winner_user_id TEXT, loser_user_id TEXT, score TEXT NOT NULL DEFAULT '', transfer INTEGER, settlement_token TEXT, settled_at INTEGER, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS ranked_rating_events (series_id TEXT PRIMARY KEY NOT NULL, winner_user_id TEXT NOT NULL, loser_user_id TEXT NOT NULL, winner_before INTEGER NOT NULL, loser_before INTEGER NOT NULL, transfer INTEGER NOT NULL, winner_after INTEGER NOT NULL, loser_after INTEGER NOT NULL, settled_at INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS ranked_rating_events_winner_idx ON ranked_rating_events(winner_user_id, settled_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS ranked_rating_events_loser_idx ON ranked_rating_events(loser_user_id, settled_at DESC)"),
  ]);
  rankedSchemaReady = true;
}

function constructionIdentity(card: (typeof CARDS)[number]) {
  const record = card as (typeof card & { constructionIdentity?: string });
  return record.constructionIdentity ?? `${card.name ?? card.displayName ?? card.catalogId}|${card.effect ?? ""}`;
}

function normalizeRestriction(value: unknown): DeckRestriction | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const limit = Number(input.limit);
  if (![0, 1, 2].includes(limit)) return null;
  const catalogId = String(input.catalogId ?? "");
  const card = CARDS.find((candidate) => candidate.catalogId === catalogId);
  const identity = card ? constructionIdentity(card) : String(input.constructionIdentity ?? "").trim();
  if (!identity) return null;
  return { constructionIdentity: identity, limit: limit as 0 | 1 | 2, reason: String(input.reason ?? "").trim().slice(0, 300) };
}

function parseRuleset(value: string | null | undefined): RankedRuleset | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(value) as Partial<RankedRuleset>;
    if (!Number.isInteger(raw.version) || Number(raw.version) < 1 || !Array.isArray(raw.restrictions)) return null;
    return {
      version: Number(raw.version),
      restrictions: raw.restrictions.map(normalizeRestriction).filter((item): item is DeckRestriction => Boolean(item)),
      publishedAt: Number(raw.publishedAt) || 0,
      publishedBy: raw.publishedBy ? String(raw.publishedBy) : undefined,
    };
  } catch {
    return null;
  }
}

export async function getActiveRankedRuleset(db: AccountDatabase): Promise<RankedRuleset> {
  await ensureRankedSchema(db);
  const row = await db.prepare("SELECT data_json FROM admin_resources WHERE resource_type = 'ranked-ruleset' AND resource_id = 'active'")
    .first<{ data_json: string }>();
  return parseRuleset(row?.data_json) ?? { version: 1, restrictions: [], publishedAt: 0 };
}

export async function getRankedRulesAdministration(db: AccountDatabase) {
  await ensureRankedSchema(db);
  const [active, draftRow, historyRows, indicatorRows] = await Promise.all([
    getActiveRankedRuleset(db),
    db.prepare("SELECT data_json FROM admin_resources WHERE resource_type = 'ranked-ruleset' AND resource_id = 'draft'").first<{ data_json: string }>(),
    db.prepare("SELECT resource_id, data_json FROM admin_resources WHERE resource_type = 'ranked-ruleset-history' ORDER BY updated_at DESC LIMIT 25").all(),
    db.prepare(`SELECT first_user.display_name AS first_name, second_user.display_name AS second_name,
      COUNT(*) AS series_count, MAX(ranked_series.settled_at) AS last_seen
      FROM ranked_series
      JOIN users first_user ON first_user.id = ranked_series.player_one_user_id
      JOIN users second_user ON second_user.id = ranked_series.player_two_user_id
      WHERE ranked_series.settled_at IS NOT NULL AND ranked_series.settled_at >= ?
      GROUP BY CASE WHEN player_one_user_id < player_two_user_id THEN player_one_user_id ELSE player_two_user_id END,
        CASE WHEN player_one_user_id < player_two_user_id THEN player_two_user_id ELSE player_one_user_id END
      HAVING COUNT(*) >= 4 ORDER BY series_count DESC, last_seen DESC LIMIT 30`)
      .bind(Date.now() - 86_400_000).all<Record<string, unknown>>(),
  ]);
  const draft = parseRuleset(draftRow?.data_json) ?? active;
  const history = (historyRows.results ?? []).map((row) => parseRuleset(String(row.data_json))).filter((item): item is RankedRuleset => Boolean(item));
  return {
    active,
    draft,
    history,
    indicators: (indicatorRows.results ?? []).map((row) => ({
      firstName: String(row.first_name),
      secondName: String(row.second_name),
      seriesCount: Number(row.series_count),
      lastSeen: Number(row.last_seen),
      reason: "Repeated Ranked opponents within 24 hours",
    })),
    cards: CARDS.filter((card) => card.type !== "Character").map((card) => ({
      catalogId: card.catalogId,
      name: card.displayName,
      constructionIdentity: constructionIdentity(card),
    })),
  };
}

function normalizedRestrictions(value: unknown) {
  if (!Array.isArray(value)) return [];
  const byIdentity = new Map<string, DeckRestriction>();
  for (const raw of value) {
    const restriction = normalizeRestriction(raw);
    if (restriction) byIdentity.set(restriction.constructionIdentity, restriction);
  }
  return [...byIdentity.values()];
}

async function writeAdminResource(db: AccountDatabase, type: string, id: string, value: unknown, administratorId: string) {
  await db.prepare("INSERT INTO admin_resources (resource_type, resource_id, data_json, enabled, updated_by, updated_at) VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(resource_type, resource_id) DO UPDATE SET data_json = excluded.data_json, enabled = 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
    .bind(type, id, JSON.stringify(value), administratorId, Date.now()).run();
}

export async function saveRankedRulesDraft(db: AccountDatabase, restrictions: unknown, administratorId: string) {
  const active = await getActiveRankedRuleset(db);
  const draft: RankedRuleset = { ...active, restrictions: normalizedRestrictions(restrictions) };
  await writeAdminResource(db, "ranked-ruleset", "draft", draft, administratorId);
  return draft;
}

export async function publishRankedRules(db: AccountDatabase, restrictions: unknown, administratorId: string) {
  const active = await getActiveRankedRuleset(db);
  const ruleset: RankedRuleset = {
    version: active.version + 1,
    restrictions: normalizedRestrictions(restrictions),
    publishedAt: Date.now(),
    publishedBy: administratorId,
  };
  await db.batch([
    db.prepare("INSERT INTO admin_resources (resource_type, resource_id, data_json, enabled, updated_by, updated_at) VALUES ('ranked-ruleset', 'active', ?, 1, ?, ?) ON CONFLICT(resource_type, resource_id) DO UPDATE SET data_json = excluded.data_json, enabled = 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
      .bind(JSON.stringify(ruleset), administratorId, ruleset.publishedAt),
    db.prepare("INSERT INTO admin_resources (resource_type, resource_id, data_json, enabled, updated_by, updated_at) VALUES ('ranked-ruleset-history', ?, ?, 1, ?, ?)")
      .bind(`v${ruleset.version}`, JSON.stringify(ruleset), administratorId, ruleset.publishedAt),
    db.prepare("DELETE FROM admin_resources WHERE resource_type = 'ranked-ruleset' AND resource_id = 'draft'"),
  ]);
  return ruleset;
}

export async function rollbackRankedRules(db: AccountDatabase, sourceVersion: number, administratorId: string) {
  const row = await db.prepare("SELECT data_json FROM admin_resources WHERE resource_type = 'ranked-ruleset-history' AND resource_id = ?")
    .bind(`v${sourceVersion}`).first<{ data_json: string }>();
  const source = parseRuleset(row?.data_json);
  if (!source) throw new Error("That Ranked ruleset version is unavailable.");
  return publishRankedRules(db, source.restrictions, administratorId);
}

type RatingEventRow = {
  series_id: string;
  winner_user_id: string;
  loser_user_id: string;
  winner_before: number;
  loser_before: number;
  transfer: number;
  winner_after: number;
  loser_after: number;
  settled_at: number;
};

function settlementFromRow(row: RatingEventRow): RankedSettlement {
  return {
    seriesId: row.series_id,
    winnerUserId: row.winner_user_id,
    loserUserId: row.loser_user_id,
    winnerBefore: row.winner_before,
    loserBefore: row.loser_before,
    transfer: row.transfer,
    winnerAfter: row.winner_after,
    loserAfter: row.loser_after,
    settledAt: row.settled_at,
  };
}

export async function settleRankedSeries(db: AccountDatabase, input: {
  seriesId: string;
  rulesetVersion: number;
  playerOneUserId: string;
  playerTwoUserId: string;
  winnerUserId: string;
  loserUserId: string;
  score: string;
}): Promise<RankedSettlement> {
  await ensureRankedSchema(db);
  const existing = await db.prepare("SELECT * FROM ranked_rating_events WHERE series_id = ?").bind(input.seriesId).first<RatingEventRow>();
  if (existing) return settlementFromRow(existing);
  const now = Date.now();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO ranked_ratings (user_id, bp, wins, losses, last_achieved_at, updated_at) VALUES (?, ?, 0, 0, ?, ?)").bind(input.playerOneUserId, RANKED_STARTING_BP, now, now),
    db.prepare("INSERT OR IGNORE INTO ranked_ratings (user_id, bp, wins, losses, last_achieved_at, updated_at) VALUES (?, ?, 0, 0, ?, ?)").bind(input.playerTwoUserId, RANKED_STARTING_BP, now, now),
    db.prepare("INSERT OR IGNORE INTO ranked_series (series_id, ruleset_version, player_one_user_id, player_two_user_id, score, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(input.seriesId, input.rulesetVersion, input.playerOneUserId, input.playerTwoUserId, input.score, now),
  ]);
  const ratings = await db.prepare("SELECT user_id, bp FROM ranked_ratings WHERE user_id IN (?, ?)")
    .bind(input.winnerUserId, input.loserUserId).all<{ user_id: string; bp: number }>();
  const byUser = new Map((ratings.results ?? []).map((row) => [row.user_id, row.bp]));
  const winnerBefore = byUser.get(input.winnerUserId) ?? RANKED_STARTING_BP;
  const loserBefore = byUser.get(input.loserUserId) ?? RANKED_STARTING_BP;
  const { transfer } = eloTransfer(winnerBefore, loserBefore);
  const token = crypto.randomUUID();
  await db.batch([
    db.prepare("UPDATE ranked_series SET settlement_token = ? WHERE series_id = ? AND settled_at IS NULL AND settlement_token IS NULL").bind(token, input.seriesId),
    db.prepare("UPDATE ranked_ratings SET bp = bp + ?, wins = wins + 1, last_achieved_at = ?, updated_at = ? WHERE user_id = ? AND EXISTS (SELECT 1 FROM ranked_series WHERE series_id = ? AND settlement_token = ? AND settled_at IS NULL)").bind(transfer, now, now, input.winnerUserId, input.seriesId, token),
    db.prepare("UPDATE ranked_ratings SET bp = bp - ?, losses = losses + 1, updated_at = ? WHERE user_id = ? AND EXISTS (SELECT 1 FROM ranked_series WHERE series_id = ? AND settlement_token = ? AND settled_at IS NULL)").bind(transfer, now, input.loserUserId, input.seriesId, token),
    db.prepare("INSERT INTO ranked_rating_events (series_id, winner_user_id, loser_user_id, winner_before, loser_before, transfer, winner_after, loser_after, settled_at) SELECT ?, ?, ?, (SELECT bp - ? FROM ranked_ratings WHERE user_id = ?), (SELECT bp + ? FROM ranked_ratings WHERE user_id = ?), ?, (SELECT bp FROM ranked_ratings WHERE user_id = ?), (SELECT bp FROM ranked_ratings WHERE user_id = ?), ? WHERE EXISTS (SELECT 1 FROM ranked_series WHERE series_id = ? AND settlement_token = ? AND settled_at IS NULL)").bind(input.seriesId, input.winnerUserId, input.loserUserId, transfer, input.winnerUserId, transfer, input.loserUserId, transfer, input.winnerUserId, input.loserUserId, now, input.seriesId, token),
    db.prepare("UPDATE ranked_series SET winner_user_id = ?, loser_user_id = ?, score = ?, transfer = ?, settled_at = ? WHERE series_id = ? AND settlement_token = ? AND settled_at IS NULL").bind(input.winnerUserId, input.loserUserId, input.score, transfer, now, input.seriesId, token),
  ]);
  const settled = await db.prepare("SELECT * FROM ranked_rating_events WHERE series_id = ?").bind(input.seriesId).first<RatingEventRow>();
  if (!settled) throw new Error("Ranked BP could not be settled.");
  return settlementFromRow(settled);
}

function readSnapshot(value: unknown) {
  try { return JSON.parse(String(value ?? "{}")) as Record<string, unknown>; } catch { return {}; }
}

function publicProfileFromSnapshot(value: unknown) {
  const snapshot = readSnapshot(value);
  const profile = snapshot.profile && typeof snapshot.profile === "object" ? snapshot.profile as Record<string, unknown> : {};
  const decks = Array.isArray(snapshot.decks) ? snapshot.decks : [];
  const showcaseDeckIds = Array.isArray(profile.showcaseDeckIds) ? profile.showcaseDeckIds.map(String) : [];
  return {
    avatarId: String(profile.avatarId ?? "dan"),
    titleId: String(profile.titleId ?? "brawler"),
    coverId: String(profile.coverId ?? "default"),
    showcaseAchievementIds: Array.isArray(profile.showcaseAchievementIds) ? profile.showcaseAchievementIds.map(String).slice(0, 3) : [],
    showcaseDecks: decks.filter((deck): deck is Record<string, unknown> => Boolean(deck && typeof deck === "object"))
      .filter((deck) => deck.visibility === "Public" && showcaseDeckIds.includes(String(deck.id)))
      .slice(0, 3)
      .map((deck) => ({ id: String(deck.id), name: String(deck.name), factions: Array.isArray(deck.factions) ? deck.factions.map(String) : [] })),
  };
}

export async function rankedProfile(db: AccountDatabase, userId: string) {
  await ensureRankedSchema(db);
  const row = await db.prepare("SELECT users.id, users.display_name, users.faction, users.created_at, COALESCE(ranked_ratings.bp, 1000) AS bp, COALESCE(ranked_ratings.wins, 0) AS wins, COALESCE(ranked_ratings.losses, 0) AS losses, user_data.data_json FROM users LEFT JOIN ranked_ratings ON ranked_ratings.user_id = users.id LEFT JOIN user_data ON user_data.user_id = users.id LEFT JOIN account_bans ON account_bans.user_id = users.id WHERE users.id = ? AND account_bans.user_id IS NULL")
    .bind(userId).first<Record<string, unknown>>();
  if (!row) return null;
  const bp = Number(row.bp);
  const wins = Number(row.wins);
  const losses = Number(row.losses);
  return {
    userId: String(row.id), displayName: String(row.display_name), faction: String(row.faction), joinedAt: Number(row.created_at),
    bp, rank: rankForBp(bp), wins, losses, winRate: wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0,
    ...publicProfileFromSnapshot(row.data_json),
  };
}

export async function rankedLeaderboard(db: AccountDatabase, options: { page: number; pageSize: number; search: string; viewer?: AccountUser | null }) {
  await ensureRankedSchema(db);
  const page = Number.isFinite(options.page) ? Math.max(1, Math.floor(options.page)) : 1;
  const pageSize = Number.isFinite(options.pageSize) ? Math.min(50, Math.max(10, Math.floor(options.pageSize))) : 25;
  const search = options.search.trim().slice(0, 40);
  const where = search ? "AND users.display_name LIKE ? ESCAPE '\\' COLLATE NOCASE" : "";
  const binding = search ? `%${search.replace(/[\\%_]/g, "\\$&")}%` : null;
  const query = `SELECT users.id, users.display_name, users.faction, ranked_ratings.bp, ranked_ratings.wins, ranked_ratings.losses, ranked_ratings.last_achieved_at FROM ranked_ratings JOIN users ON users.id = ranked_ratings.user_id LEFT JOIN account_bans ON account_bans.user_id = users.id WHERE account_bans.user_id IS NULL ${where} ORDER BY bp DESC, wins DESC, last_achieved_at ASC, users.id ASC LIMIT ? OFFSET ?`;
  const statement = db.prepare(query);
  const result = search
    ? await statement.bind(binding, pageSize, (page - 1) * pageSize).all<Record<string, unknown>>()
    : await statement.bind(pageSize, (page - 1) * pageSize).all<Record<string, unknown>>();
  const countStatement = db.prepare(`SELECT COUNT(*) AS count FROM ranked_ratings JOIN users ON users.id = ranked_ratings.user_id LEFT JOIN account_bans ON account_bans.user_id = users.id WHERE account_bans.user_id IS NULL ${where}`);
  const count = search ? await countStatement.bind(binding).first<{ count: number }>() : await countStatement.first<{ count: number }>();
  const entries = (result.results ?? []).map((row, index) => {
    const bp = Number(row.bp); const wins = Number(row.wins); const losses = Number(row.losses);
    return { position: (page - 1) * pageSize + index + 1, userId: String(row.id), displayName: String(row.display_name), faction: String(row.faction), bp, rank: rankForBp(bp), wins, losses, winRate: wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0 };
  });
  let viewerPosition: number | null = null;
  if (options.viewer) {
    const viewerRating = await db.prepare("SELECT bp, wins, last_achieved_at AS achieved FROM ranked_ratings WHERE user_id = ?").bind(options.viewer.id).first<{ bp: number; wins: number; achieved: number }>();
    if (viewerRating) {
      const ahead = await db.prepare("SELECT COUNT(*) AS count FROM ranked_ratings JOIN users ON users.id = ranked_ratings.user_id LEFT JOIN account_bans ON account_bans.user_id = users.id WHERE account_bans.user_id IS NULL AND (ranked_ratings.bp > ? OR (ranked_ratings.bp = ? AND ranked_ratings.wins > ?) OR (ranked_ratings.bp = ? AND ranked_ratings.wins = ? AND ranked_ratings.last_achieved_at < ?))").bind(viewerRating.bp, viewerRating.bp, viewerRating.wins, viewerRating.bp, viewerRating.wins, viewerRating.achieved).first<{ count: number }>();
      viewerPosition = Number(ahead?.count ?? 0) + 1;
    }
  }
  return { entries, page, pageSize, total: Number(count?.count ?? 0), viewerPosition, viewerUserId: options.viewer?.id ?? null };
}
