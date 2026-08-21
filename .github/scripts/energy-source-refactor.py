from pathlib import Path
import re


def edit(path: str, transform):
    file = Path(path)
    text = file.read_text()
    updated = transform(text)
    if updated == text:
        print(f"no change: {path}")
    file.write_text(updated)


# PlayerState owns the physical Energy zone and the generated Energy pool.
# There is no separate cached physical-card count.
edit(
    "lib/game.ts",
    lambda text: text
    .replace("  maxEnergy: number;\n", "")
    .replace("    player.maxEnergy += 1;\n", "")
    .replace(
        '  if (lower.includes("turbo")) return player.maxEnergy > opponent.maxEnergy;',
        '  if (lower.includes("turbo")) return player.energyZone.length > opponent.energyZone.length;',
    )
    .replace(
        "    owner.maxEnergy = owner.energyZone.length;\n    owner.energy = Math.min(owner.energy, owner.maxEnergy);\n",
        "",
    )
    .replace("  player.maxEnergy = player.energyZone.length;\n", "")
    .replace(
        "    player.energy = 0; player.maxEnergy = 0; player.ready = true;",
        "    player.energy = 0; player.ready = true;",
    ),
)

edit("lib/data.ts", lambda text: text.replace("    maxEnergy: 0,\n", ""))
edit("lib/engine/deck-manifest.ts", lambda text: text.replace("  player.maxEnergy = 0;\n", ""))

edit(
    "lib/energy.ts",
    lambda text: text
    .replace("  maxEnergy: number;\n", "")
    .replace(
        "const EMPTY_ENERGY_ZONE_VIEW: EnergyZoneView = { cards: [], tappedEnergyIds: [], availableEnergy: 0, maxEnergy: 0 };",
        "const EMPTY_ENERGY_ZONE_VIEW: EnergyZoneView = { cards: [], tappedEnergyIds: [], availableEnergy: 0 };",
    )
    .replace("    maxEnergy: player.energyZone.length,\n", "")
    .replace("  player.maxEnergy = player.energyZone.length;\n", ""),
)


def rewrite_events(text: str) -> str:
    old = '''    if (previous.energy !== player.energy || previous.maxEnergy !== player.maxEnergy) {
      events.push({
        type: "ENERGY_CHANGED",
        actorId: envelope.actorId,
        visibility: "public",
        payload: {
          playerId: player.id,
          energyBefore: previous.energy,
          energyAfter: player.energy,
          maxEnergyBefore: previous.maxEnergy,
          maxEnergyAfter: player.maxEnergy,
        },
      });
    }
'''
    new = '''    if (previous.energy !== player.energy || previous.energyZone.length !== player.energyZone.length) {
      events.push({
        type: "ENERGY_CHANGED",
        actorId: envelope.actorId,
        visibility: "public",
        payload: {
          playerId: player.id,
          energyBefore: previous.energy,
          energyAfter: player.energy,
          energyCardCountBefore: previous.energyZone.length,
          energyCardCountAfter: player.energyZone.length,
        },
      });
    }
'''
    if old not in text:
        raise SystemExit("ENERGY_CHANGED legacy block not found")
    return text.replace(old, new, 1)


edit("lib/engine/events.ts", rewrite_events)
edit(
    "lib/engine/replay-codec.ts",
    lambda text: text
    .replace("    ...(player.maxEnergy ? { me: player.maxEnergy } : {}),\n", "")
    .replace("    maxEnergy: player.me ?? 0,\n", ""),
)
edit("lib/engine/replay-types.ts", lambda text: text.replace("  me?: number;\n", ""))

edit(
    "lib/rules/values.ts",
    lambda text: text
    .replace('  | "energy-zone-size"\n', "")
    .replace('  | "max-energy"\n', "")
    .replace('    case "energy-zone-size": return player.energyZone.length;\n', "")
    .replace('    case "max-energy": return player.maxEnergy;\n', ""),
)

edit(
    "lib/rules/model.ts",
    lambda text: text.replace(
        '  | { kind: "energy-count"; comparison: "at-least"; amount: NumberValue }\n',
        "",
    ),
)
edit(
    "lib/rules/modifiers.ts",
    lambda text: text
    .replace(
        '    case "turbo": return Boolean(opponent && player.maxEnergy > opponent.maxEnergy);',
        '    case "turbo": return Boolean(opponent && player.energyZone.length > opponent.energyZone.length);',
    )
    .replace('    case "energy-count": return player.maxEnergy >= conditionValue(condition.amount);\n', ""),
)


def rewrite_catalogue(text: str) -> str:
    old_condition = 'if (energyCount) return { kind: "expression", expression: { kind: "compare-number", left: { kind: "property", subject: { kind: "player", owner: "controller" }, property: "max-energy" }, operator: ">=", right: numberValue(energyCount[1], 1) } };'
    new_condition = 'if (energyCount) return { kind: "expression", expression: { kind: "compare-number", left: { kind: "count", source: "energy", owner: "controller" }, operator: ">=", right: numberValue(energyCount[1], 1) } };'
    old_scale = 'if (/Energy card.*you have|Energy cards? in play/i.test(grammar)) return multiplyValue(baseAmount, { kind: "property", subject: { kind: "player", owner: "controller" }, property: "max-energy" });'
    new_scale = 'if (/Energy card.*you have|Energy cards? in play/i.test(grammar)) return multiplyValue(baseAmount, { kind: "count", source: "energy", owner: "controller" });'
    if old_condition not in text or old_scale not in text:
        raise SystemExit("Energy catalogue legacy grammar not found")
    return text.replace(old_condition, new_condition, 1).replace(old_scale, new_scale, 1)


edit("lib/rules/catalogue-primitives.ts", rewrite_catalogue)

# Shared fixture helper for tests that previously forged the cached count without
# putting physical cards in the Energy zone.
helper = '''import { CARDS } from "../../lib/data";
import type { PlayerState } from "../../lib/game";

const ENERGY_CARD_TEMPLATE = CARDS.find((card) => card.type === "Action" && card.cost !== "X");
if (!ENERGY_CARD_TEMPLATE) throw new Error("The test catalogue needs an Energy fixture card.");

export function setPhysicalEnergy(player: PlayerState, amount: number) {
  const count = Math.max(0, Math.floor(amount));
  player.energyZone = Array.from({ length: count }, (_, index) => ({
    ...ENERGY_CARD_TEMPLATE,
    id: `${player.id}-test-energy-${index}`,
  }));
}
'''
Path("tests/helpers").mkdir(exist_ok=True)
Path("tests/helpers/energy.ts").write_text(helper)

# Migrate every old test fixture. If the test already constructed the physical
# Energy zone, the redundant assignment is simply deleted. Otherwise replace
# the forged count with actual fixture cards.
for path in Path("tests").glob("*.test.ts"):
    text = path.read_text()
    if "maxEnergy" not in text and 'property: "max-energy"' not in text:
        continue

    # Normalize the one known printed Energy threshold assertion.
    text = text.replace(
        '{ kind: "property", subject: { kind: "player", owner: "controller" }, property: "max-energy" }',
        '{ kind: "count", source: "energy", owner: "controller" }',
    )
    text = re.sub(r"\bmaxEnergy:\s*0,\s*", "", text)

    lines = text.splitlines(keepends=True)
    needs_helper = False
    out: list[str] = []
    for index, line in enumerate(lines):
        match = re.match(
            r"^(\s*)([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\[[^\]]+\])*)\.maxEnergy\s*=\s*(.+?);\s*$",
            line.rstrip("\n"),
        )
        if not match:
            out.append(line)
            continue
        indent, owner, amount = match.groups()
        normalized_amount = re.sub(r"\s+", "", amount)
        normalized_owner = re.sub(r"\s+", "", owner)
        if normalized_amount == f"{normalized_owner}.energyZone.length":
            continue
        previous = "".join(lines[max(0, index - 8):index])
        if re.search(re.escape(owner) + r"\.energyZone\s*=", previous):
            continue
        out.append(f"{indent}setPhysicalEnergy({owner}, {amount});\n")
        needs_helper = True
    text = "".join(out)

    # Handle read-only references (principally assertions) after assignments are gone.
    text = re.sub(r"\.maxEnergy\b", ".energyZone.length", text)
    if needs_helper and 'from "./helpers/energy"' not in text:
        text = 'import { setPhysicalEnergy } from "./helpers/energy";\n' + text
    path.write_text(text)

energy_test = r'''import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { energyZoneView } from "../lib/energy";
import { createMatch } from "../lib/game";
import { compactReplayPlayer, expandReplayPlayer } from "../lib/engine/replay-codec";
import { conditionFor } from "../lib/rules/catalogue-primitives";
import { ruleConditionActive, evaluateBakuganCharacteristics } from "../lib/rules/modifiers";
import { evaluateNumberValue } from "../lib/rules/values";
import { setPhysicalEnergy } from "./helpers/energy";

function match() {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("ENERGY-SOURCE", "bo1", [first, second]);
  state.turn = 2;
  state.phase = "power";
  state.startingPlayer = first.id;
  state.priority = first.id;
  state.selected[first.id] = first.bakugan[0].id;
  state.selected[second.id] = second.bakugan[0].id;
  first.bakugan[0].open = true;
  second.bakugan[0].open = true;
  return { state, first, second };
}

function allTypeScriptSources(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = `${root}/${entry.name}`;
    return entry.isDirectory()
      ? allTypeScriptSources(path)
      : entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")
        ? [readFileSync(path, "utf8")]
        : [];
  });
}

test("physical Energy cards are the only Energy-card count source", () => {
  const { state, first, second } = match();
  setPhysicalEnergy(first, 2);
  setPhysicalEnergy(second, 3);
  first.energy = 50;
  second.energy = 0;
  assert.equal(evaluateNumberValue(state, { kind: "count", source: "energy", owner: "controller" }, { controllerId: first.id }), 2);
  assert.equal(ruleConditionActive(state, first, { kind: "turbo" }), false);
  setPhysicalEnergy(first, 4);
  assert.equal(ruleConditionActive(state, first, { kind: "turbo" }), true);
  second.energy = 999;
  assert.equal(ruleConditionActive(state, first, { kind: "turbo" }), true, "floating/generated Energy must not affect Turbo");
});

test("printed Energy-card thresholds compile to the canonical count expression", () => {
  assert.deepEqual(conditionFor("If you have ten or more Energy cards in play, +15 [Damage Rating] instead."), {
    kind: "expression",
    expression: {
      kind: "compare-number",
      left: { kind: "count", source: "energy", owner: "controller" },
      operator: ">=",
      right: 10,
    },
  });
});

test("Wynton scales from physical Energy cards and ignores generated Energy", () => {
  const { state, first } = match();
  const wynton = CARDS.find((card) => card.catalogId === "aa-75");
  assert.ok(wynton);
  first.heroes = [{ ...wynton, id: "wynton-live" }];
  const bakugan = first.bakugan[0];
  const baseDamage = bakugan.character.damage ?? bakugan.damage;
  setPhysicalEnergy(first, 6);
  first.energy = 100;
  assert.equal(evaluateBakuganCharacteristics(state, bakugan, first).damage, baseDamage + 6);
  setPhysicalEnergy(first, 9);
  first.energy = 0;
  assert.equal(evaluateBakuganCharacteristics(state, bakugan, first).damage, baseDamage + 9);
});

test("runtime views and replay encoding derive Energy-card count from the zone", () => {
  const player = makePlayer("first", "First", STARTER_DECKS[0]);
  setPhysicalEnergy(player, 3);
  assert.equal("maxEnergy" in player, false);
  assert.equal("maxEnergy" in energyZoneView(player, 1), false);
  const compact = compactReplayPlayer(player);
  assert.equal("me" in compact, false);
  const expanded = expandReplayPlayer({ ...compact, me: 99 } as Parameters<typeof expandReplayPlayer>[0] & { me: number });
  assert.equal("maxEnergy" in expanded, false);
  assert.equal(expanded.energyZone.length, 3);
});

test("production source contains no cached Energy-count compatibility path", () => {
  const libRoot = fileURLToPath(new URL("../lib", import.meta.url));
  const source = allTypeScriptSources(libRoot).join("\n");
  assert.doesNotMatch(source, /\bmaxEnergy\b|["']max-energy["']|["']energy-zone-size["']/);
  assert.doesNotMatch(source, /kind:\s*["']energy-count["']/);
});
'''
Path("tests/energy-count-source.test.ts").write_text(energy_test)

package = Path("package.json")
package_text = package.read_text()
if "tests/energy-count-source.test.ts" not in package_text:
    package_text, changed = re.subn(
        r'("test:rules"\s*:\s*"[^"]*)"',
        r'\1 tests/energy-count-source.test.ts"',
        package_text,
        count=1,
    )
    if changed != 1:
        raise SystemExit("test:rules script not found")
    package.write_text(package_text)
