import { CARDS } from "../data";
import type { CardChoices, CoreType, GameCard } from "../game";
import type { AbilityDefinition, CardPlayDefinition, ChoiceSpec, CostEffect, RuleAction, RuleCondition, RuleInstruction, RulesCardId } from "./model";
import { conditionFor, durationFor, parseAtomicEffects, ruleCardId } from "./catalogue-primitives";

const CORE_TYPE_BY_SYMBOL: Record<string, CoreType> = {
  FT: "Fist",
  FF: "Flaming Fist",
  SD: "Shield",
  MS: "Magic Shield",
  HE: "Helix",
  FIST: "Fist",
  "FLAMING FIST": "Flaming Fist",
  SHIELD: "Shield",
  "MAGIC SHIELD": "Magic Shield",
  HELIX: "Helix",
};

function singleAttachedCoreTypes(text: string): CoreType[] {
  const symbols = text.match(
    /\battach\s+(?:an?\s+)?(?:additional\s+|another\s+)?(\[(?:FT|FF|SD|MS|HE|Fist|Flaming Fist|Shield|Magic Shield|Helix)\](?:\s*(?:or|and)\s*\[(?:FT|FF|SD|MS|HE|Fist|Flaming Fist|Shield|Magic Shield|Helix)\])*)/i,
  )?.[1];
  if (!symbols) return [];
  return [...symbols.matchAll(/\[(FT|FF|SD|MS|HE|Fist|Flaming Fist|Shield|Magic Shield|Helix)\]/gi)]
    .map((match) => CORE_TYPE_BY_SYMBOL[match[1].toUpperCase()])
    .filter((coreType, index, values) => values.indexOf(coreType) === index);
}

function expandMultiCoreAttachment(clause: string) {
  const match = clause.match(
    /^(.*?)\bAttach\s+up to\s+(two|three|\d+)\s+(\[(?:FT|FF|SD|MS|HE)\])\s+from the Field to (.+?)\.?$/i,
  );
  if (!match) return null;
  const amount = match[2].toLowerCase() === "two" ? 2 : match[2].toLowerCase() === "three" ? 3 : Number(match[2]);
  if (!Number.isFinite(amount) || amount < 1 || amount > 10) return null;
  const prefix = match[1].trim();
  const symbol = match[3];
  const target = match[4].trim().replace(/\.$/, "");
  return Array.from({ length: amount }, (_, index) => (
    index === 0
      ? `${prefix}${prefix ? " " : ""}You may attach a ${symbol} from the Field to ${target}.`
      : `Then you may attach a ${symbol} from the Field to ${target}.`
  ));
}

type BattleMasteryBranch = { id: string; label: string; text: string };

function battleMasteryBranches(text: string): BattleMasteryBranch[] | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(
    /\bBattle Mastery:\s*(?:When you play this,\s*)?Choose one(?: of the following)?\s*[:,]?\s*(.+?)\s+or\s+(.+?)\.?$/i,
  );
  if (!match) return null;
  const clean = (value: string) => {
    const trimmed = value.trim().replace(/\.$/, "");
    return /^[a-z]/.test(trimmed) ? trimmed[0].toUpperCase() + trimmed.slice(1) : trimmed;
  };
  return [match[1], match[2]].map((value, index) => ({
    id: `battle-mastery-${index + 1}`,
    label: clean(value),
    text: clean(value),
  }));
}

function chooseOneBranches(text: string): BattleMasteryBranch[] | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(/\bChoose one\s*:\s*(.+?)\s*,?\s+or\s+(.+?)\.?$/i);
  if (!match) return null;
  const clean = (value: string) => {
    const trimmed = value.trim().replace(/^Victor\s*:\s*/i, "").replace(/\.$/, "");
    return /^[a-z]/.test(trimmed) ? trimmed[0].toUpperCase() + trimmed.slice(1) : trimmed;
  };
  return [match[1], match[2]].map((value, index) => ({
    id: `choose-one-${index + 1}`,
    label: clean(value),
    text: clean(value),
  }));
}

function splitInstructions(card: GameCard, source: string): RuleInstruction[] {
  const normalized = source.replace(/\s*\n\s*/g, " ").trim().replace(
    /(\bNegate an Action card\.)\s+(You may copy its effect(?: and make your own selections for it)?\.)/gi,
    "$1 $2",
  ).replace(
    /(Uncharge\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+Energy cards?[^.]*\.)\s+(They do not recharge at the end of the turn\.)/gi,
    "$1 $2",
  );
  const clauses = normalized
    ? normalized.split(/(?<=\.)\s+(?!They do not recharge at the end of the turn\.)/i).map((clause) => clause.trim()).filter(Boolean)
      .flatMap((clause) => {
        // "Attach up to N" is modelled as N optional sequential selections.
        // This preserves the printed 0..N choice without requiring one giant
        // multi-select answer and lets each chosen core leave the Field before
        // the next legal-choice set is calculated.
        const multiCoreAttachment = expandMultiCoreAttachment(clause);
        if (multiCoreAttachment) return multiCoreAttachment;
        // Preserve the Reroll-success condition on every dependent clause.
        // This must run before the generic "and you may Reroll" splitter so
        // cards such as Rip Tide do not turn their optional draw unconditional.
        const rerollConditional = clause.match(/^(If you open on the Reroll,\s*)(.*?)(?:,?\s+and\s+)(you may\s+.*)$/i);
        if (rerollConditional && rerollConditional[2].trim()) {
          return [
            `${rerollConditional[1]}${rerollConditional[2].trim().replace(/[,;:]$/, "")}.`,
            `${rerollConditional[1]}${rerollConditional[3].trim()}`,
          ];
        }
        const reroll = clause.match(/^(.*?)(?:,?\s+and\s+)(you may Reroll\b.*)$/i);
        if (reroll && reroll[1].trim()) {
          return [reroll[1].trim().replace(/[,;:]$/, "") + ".", reroll[2].trim()];
        }
        // A resolving Action that moves itself to the bottom of its owner's
        // deck must finish its earlier effects first. Treat the comma before
        // that self-movement as the same ordering boundary as printed “then”.
        const selfRecycle = clause.match(
          /^(.*?),\s*((?:return|put|place)\s+this\s+(?:to|on)\s+the\s+bottom\s+of\s+(?:your|its owner['’]s)\s+deck)\.?$/i,
        );
        if (selfRecycle?.[1].trim() && selfRecycle[2].trim()) {
          return [
            `${selfRecycle[1].trim().replace(/[,;:]$/, "")}.`,
            `Then ${selfRecycle[2].trim()}.`,
          ];
        }
        // Sync is a reveal-from-hand gate. Keep the base effect separate so
        // selecting a legal card controls only the Sync bonus or replacement.
        // Trigger prefixes such as Victor and When this opens must stay on the
        // Sync instruction so their event timing is preserved.
        const sync = clause.match(/^(.*?)\s+Sync:\s*(.+)$/i);
        if (sync?.[2].trim()) {
          const prefix = sync[1].trim().replace(/[,;:]$/, "");
          const triggerPrefix = /^(?:\[?Victor\]?|when this opens|when you play this(?: card)?)$/i.test(prefix);
          return triggerPrefix
            ? [`${prefix}, Sync: ${sync[2].trim()}`]
            : [
              ...(prefix ? [`${prefix}.`] : []),
              `Sync: ${sync[2].trim()}`,
            ];
        }
        // Trifecta is a keyword boundary. Keep its condition and payoff in a
        // separate instruction so the shared condition evaluator controls
        // the bonus, replacement, draw, return, or free-play effect.
        const trifecta = clause.match(/^(.*?)\s+Trifecta:\s*(.+)$/i);
        if (trifecta?.[2].trim()) {
          const prefix = trifecta[1].trim().replace(/[,;:]$/, "");
          return [
            ...(prefix ? [`${prefix}.`] : []),
            `Trifecta: ${trifecta[2].trim()}`,
          ];
        }
        // Boost is a keyword boundary, not part of the preceding effect.
        // Some printings place it after a base effect without a period (for
        // example “+4 Damage Boost: ...”), so split it before compiling the
        // two independently gated clauses. The replacement pass below then
        // turns a trailing “instead” into a single conditional branch.
        const boost = clause.match(/^(.*?)\s+Boost:\s*(.+)$/i);
        if (boost?.[1].trim() && boost[2].trim()) {
          return [
            `${boost[1].trim().replace(/[,;:]$/, "")}.`,
            `Boost: ${boost[2].trim()}`,
          ];
        }
        // A conditional Gear bonus is a separate effect from the base bonus
        // printed before it (for example “+400 B. If that Bakugan has a
        // Baku-Gear attached to it, +3 FrostStrike”).
        const gearConditional = clause.match(
          /^(?!When you play this\b)(.+?)\s+(If (?:that Bakugan|this Bakugan) has [^.]*Baku-Gear[^.]*),\s*(.+)$/i,
        );
        if (gearConditional?.[1].trim() && gearConditional[3].trim()) {
          return [
            `${gearConditional[1].trim().replace(/[,;:]$/, "")}.`,
            `${gearConditional[2].trim()}, ${gearConditional[3].trim()}`,
          ];
        }
        // A printed "then" is an ordering boundary. Keeping both halves in
        // one instruction requests all choices before either action runs,
        // which reverses effects such as "Draw two cards, then discard two
        // cards." Splitting here lets the resolver finish (and, for manual
        // draws, suspend for) the first action before it builds the second
        // action's choice schema.
        const sequential = clause.match(/^(.*?),\s+then\s+(.+)$/i);
        if (sequential?.[1].trim() && sequential[2].trim()) {
          const first = sequential[1].trim().replace(/[,;:]$/, "");
          const second = sequential[2].trim();
          const inheritsAllPlayers = /^all players\b/i.test(first)
            && /\bthat many\b/i.test(second)
            && !/\b(?:all|both|each) players\b/i.test(second);
          return [
            `${first}.`,
            `Then ${inheritsAllPlayers ? "all players " : ""}${second}`,
          ];
        }
        return [clause];
      })
      // Coordinated clauses can change grammatical subject. Parsing the full
      // sentence at once previously let “opponent” retarget an earlier “you
      // draw” action. Split only at an explicit you/opponent handoff.
      .flatMap((clause) => {
        const subjectHandoff = clause.match(/^(You\s+.+?)\s+and\s+(your opponent\s+.+)$/i);
        if (!subjectHandoff?.[1].trim() || !subjectHandoff[2].trim()) return [clause];
        const opponentClause = subjectHandoff[2].trim().replace(
          /^your opponent\s+discards\b/i,
          "Your opponent must discard",
        );
        return [
          `${subjectHandoff[1].trim().replace(/[,;:.]$/, "")}.`,
          `${opponentClause.replace(/[,;:.]$/, "")}.`,
        ];
      })
    : [""];
  const instructions = clauses.map((clause, index) => {
    const condition = conditionFor(clause);
    const effectText = clause.replace(
      /^Trifecta:\s*If your Bakugan have three or more BakuCores? (?:attached|attaced) to them\s*[,;:]\s*/i,
      "",
    );
    let effects = parseAtomicEffects(card, effectText);
    const attachedCoreTypes = singleAttachedCoreTypes(clause);
    if (attachedCoreTypes.length && !effects.some((effect) => effect.kind === "move" && effect.verb === "attach" && effect.object === "bakucore")) {
      effects = [...effects.filter((effect) => effect.kind !== "sequence"), { kind: "move", verb: "attach", object: "bakucore", amount: 1 }];
    }
    // Alternative play costs are represented in CardPlayDefinition rather than
    // erased or recognized by a printing-specific exception here.
    if (!effects.length) effects = [{ kind: "sequence", effects: [] }];
    return {
      id: `${ruleCardId(card)}:instruction:${index}`,
      condition,
      effects,
      actions: effects,
      choices: choicesForText(card, clause, "resolve"),
      sourceText: clause,
    };
  });

  // A conditional turn promise can be satisfied by an event that happens
  // after this Action leaves the Batch. Install a one-shot listener as its own
  // always-on instruction; the payoff clause still handles an event that
  // already occurred earlier in the same turn.
  for (let index = 0; index < instructions.length; index += 1) {
    const payoff = instructions[index];
    if (!/If your opponent plays a Flip card this turn/i.test(payoff.sourceText)) continue;
    const watch: RuleAction = {
      kind: "watch-turn-event",
      definition: { event: "CARD_PLAYED", relationship: "opponent", cardType: "Flip" },
      effectText: payoff.sourceText,
    };
    instructions.splice(index, 0, {
      id: `${ruleCardId(card)}:watch-turn-flip:${index}`,
      condition: { kind: "always" },
      effects: [watch],
      actions: [watch],
      choices: [],
      sourceText: `Watch this turn for: ${payoff.sourceText}`,
    });
    index += 1;
  }

  // Bind “If you do” to the optional discard that immediately precedes it.
  // This keeps payment and payoff in one instruction, so the benefit cannot
  // resolve when the player declines or has no legal card to discard.
  for (let index = 0; index < instructions.length - 1; index += 1) {
    const payment = instructions[index];
    const payoff = instructions[index + 1];
    const discard = payment.effects.find((effect) => effect.kind === "discard");
    if (!discard || !/\bmay discard\b/i.test(payment.sourceText) || !/^If you do\b/i.test(payoff.sourceText)) continue;
    const triggers = payment.effects.filter((effect) => effect.kind === "trigger");
    const effects = [
      discard,
      ...payment.effects.filter((effect) => effect !== discard && effect.kind !== "trigger"),
      ...payoff.effects,
      ...triggers,
    ];
    instructions.splice(index, 2, {
      ...payment,
      condition: { kind: "selection-made", choiceId: "discardCardIds" },
      effects,
      actions: effects,
      sourceText: `${payment.sourceText} ${payoff.sourceText}`.trim(),
    });
  }

  // Optional discard-for-benefit clauses pay before applying their payoff.
  // Some cards put the payment and payoff in one sentence (for example,
  // "may discard ... to give ..."); bind those clauses to the discard choice
  // here instead of relying on the card's unrelated Victor/Fury condition.
  for (const instruction of instructions) {
    const paidDiscardBenefit = /\bmay discard\b[^.]*?(?:\bfor\s+\+|\bto give\b[^.]*?\+)/i.test(instruction.sourceText);
    if (paidDiscardBenefit && instruction.effects.some((effect) => effect.kind === "discard")) {
      instruction.condition = { kind: "selection-made", choiceId: "discardCardIds" };
    }
    if (instruction.condition.kind !== "selection-made") continue;
    const discard = instruction.effects.find((effect) => effect.kind === "discard");
    if (!discard || instruction.effects[0] === discard || /\bSync:/i.test(instruction.sourceText)) continue;
    instruction.effects = [discard, ...instruction.effects.filter((effect) => effect !== discard)];
    instruction.actions = instruction.effects;
  }

  // The controller first chooses a player, then that chosen player privately
  // chooses the cards they must discard. Splitting the printed sentence lets
  // the second choice resolve its chooser and zone owner from targetPlayerId.
  for (let index = 0; index < instructions.length; index += 1) {
    const current = instructions[index];
    const chosenPlayerDiscard = current.sourceText.match(
      /^Choose a player to discard a card for each \[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\] Bakugan on your team\.?$/i,
    );
    if (!chosenPlayerDiscard) continue;
    const faction = `${chosenPlayerDiscard[1][0].toUpperCase()}${chosenPlayerDiscard[1].slice(1).toLowerCase()}` as GameCard["faction"];
    const amount = { kind: "count", source: "bakugan", owner: "controller", faction } as const;
    const playerChoice = current.choices.find((candidate) => candidate.id === "targetPlayerId");
    if (!playerChoice) continue;
    const chooserAction: RuleAction = { kind: "cost", amount: 0, operation: "reduce", duration: "instant" };
    const discardChoice = choice("discardCardIds", "resolve", "hand-card", "Choose cards to discard", false, "chosen-player", "private");
    discardChoice.owner = "chosen-player";
    discardChoice.targetOwner = "chosen-player";
    discardChoice.minimum = amount;
    discardChoice.maximum = amount;
    const discardAction: RuleAction = {
      kind: "discard",
      amount,
      minimum: amount,
      maximum: amount,
      repeated: false,
      playerScope: "chosen-player",
    };
    instructions.splice(index, 1,
      {
        ...current,
        id: `${ruleCardId(card)}:choose-discard-player`,
        effects: [chooserAction],
        actions: [chooserAction],
        choices: [playerChoice],
      },
      {
        id: `${ruleCardId(card)}:chosen-player-discard`,
        condition: { kind: "always" },
        effects: [discardAction],
        actions: [discardAction],
        choices: [discardChoice],
        sourceText: `That player discards a card for each [${faction}] Bakugan on your team.`,
      },
    );
    index += 1;
  }

  // Generic printed choose-one clauses use the same modal primitive as Battle
  // Mastery, without granting Magnus's additional Both option.
  for (let index = 0; index < instructions.length; index += 1) {
    const current = instructions[index];
    const branches = chooseOneBranches(current.sourceText);
    if (!branches) continue;
    const modeChoice = current.choices.find((candidate) => candidate.id === "mode");
    if (!modeChoice) continue;
    const noOp: RuleAction = { kind: "cost", amount: 0, operation: "reduce", duration: "instant" };
    const triggerEffects = current.effects.filter((effect) => effect.kind === "trigger");
    const chooserEffects = [...triggerEffects, noOp];
    const chooser: RuleInstruction = {
      ...current,
      id: `${ruleCardId(card)}:choose-one-choice`,
      condition: current.condition,
      effects: chooserEffects,
      actions: chooserEffects,
      choices: [{ ...modeChoice, options: branches.map((branch) => ({ id: branch.id, label: branch.label })) }],
    };
    const branchInstructions = branches.map((branch): RuleInstruction => {
      const effects = parseAtomicEffects(card, branch.text).filter((effect) => effect.kind !== "trigger");
      const actions = effects.length ? effects : [{ kind: "sequence", effects: [] } as RuleAction];
      return {
        id: `${ruleCardId(card)}:${branch.id}`,
        condition: { kind: "mode-selected", mode: branch.id },
        effects: actions,
        actions,
        choices: choicesForText(card, branch.text, "resolve").filter((candidate) => candidate.id !== "mode"),
        sourceText: branch.text,
      };
    });
    instructions.splice(index, 1, chooser, ...branchInstructions);
    index += branchInstructions.length;
  }

  // X-cost two-stat cards choose one scaling branch; paying X does not grant
  // both bonuses. The selected X is captured by the existing pay-time choice.
  for (let index = 0; index < instructions.length; index += 1) {
    const current = instructions[index];
    if (!/For each \[Energy\] used, give a Bakugan \+\d+ \[B\] or \+\d+ \[Damage Rating\]/i.test(current.sourceText)) continue;
    const power = Number(current.sourceText.match(/\+(\d+) \[B\]/i)?.[1] ?? 0);
    const damage = Number(current.sourceText.match(/\+(\d+) \[Damage Rating\]/i)?.[1] ?? 0);
    const mode = current.choices.find((choice) => choice.id === "mode");
    if (!mode) continue;
    const target = current.choices.find((choice) => choice.id === "targetBakuganId");
    const xValue = { kind: "choice-value", choiceId: "xValue" as const } as const;
    const makeBranch = (id: string, stat: "power" | "damage", base: number): RuleInstruction => {
      const effects: RuleAction[] = [{ kind: "modify-stat", stat, amount: { kind: "product", factors: [base, xValue] }, duration: "instant", scope: "target" }];
      return { id: `${ruleCardId(card)}:${id}`, condition: { kind: "mode-selected", mode: id }, effects, actions: effects, choices: target ? [target] : [], sourceText: stat === "power" ? `+${power} [B] for each Energy used` : `+${damage} [Damage Rating] for each Energy used` };
    };
    const noOp: RuleAction = { kind: "cost", amount: 0, operation: "reduce", duration: "instant" };
    instructions.splice(index, 1,
      { ...current, id: `${ruleCardId(card)}:x-mode`, effects: [noOp], actions: [noOp], choices: [{ ...mode, options: [{ id: "x-power", label: `+${power} [B] per Energy` }, { id: "x-damage", label: `+${damage} [Damage Rating] per Energy` }] }] },
      makeBranch("x-power", "power", power),
      makeBranch("x-damage", "damage", damage),
    );
    index += 2;
  }

  // “Use this any number of times” repeats the immediately preceding paid
  // clause, not the whole card. Keep the payment and benefit together so each
  // iteration obtains a fresh legal hand selection and resolves independently.
  for (let index = 1; index < instructions.length; index += 1) {
    const repeatClause = instructions[index];
    if (!/^You may use this any number of times\.?$/i.test(repeatClause.sourceText.trim())) continue;
    const repeated = instructions[index - 1];
    if (!repeated.effects.some((effect) => effect.kind === "discard")) continue;
    repeated.repeatWhileSelected = "discardCardIds";
    repeated.sourceText = `${repeated.sourceText} ${repeatClause.sourceText}`.trim();
    const discardFirst = repeated.effects.find((effect) => effect.kind === "discard");
    if (discardFirst) {
      repeated.effects = [discardFirst, ...repeated.effects.filter((effect) => effect !== discardFirst)];
      repeated.actions = repeated.effects;
    }
    instructions.splice(index, 1);
    index -= 1;
  }

  for (const instruction of instructions) {
    if (!/\bSacrifice\b[\s\S]*\bmay discard\b[\s\S]*\bto Reroll\b/i.test(instruction.sourceText)) continue;
    instruction.condition = { kind: "always" };
    let sacrifice = instruction.choices.find((candidate) => candidate.id === "discardCardIds");
    if (!sacrifice) {
      sacrifice = choice("discardCardIds", "resolve", "hand-card", "Choose cards to sacrifice", true, "controller", "private");
      sacrifice.owner = "controller";
      instruction.choices.push(sacrifice);
    }
    sacrifice.minimum = 0;
    sacrifice.maximum = 1;
  }

  // Battle Mastery presents one printed choice before either branch resolves.
  // Compile the choice as an always-on no-op instruction, then gate each
  // branch on the selected mode. Earlier instruction choices are deliberately
  // merged forward by the resolver, so Magnus can make both branch conditions true.
  for (let index = 0; index < instructions.length; index += 1) {
    const current = instructions[index];
    const branches = battleMasteryBranches(current.sourceText);
    if (!branches) continue;
    const modeChoice = current.choices.find((candidate) => candidate.id === "mode");
    if (!modeChoice) continue;
    const noOp: RuleAction = { kind: "cost", amount: 0, operation: "reduce", duration: "instant" };
    const triggerEffects = current.effects.filter((effect) => effect.kind === "trigger");
    const chooserEffects: RuleAction[] = triggerEffects.length ? [...triggerEffects, noOp] : [noOp];
    const chooser: RuleInstruction = {
      ...current,
      id: `${ruleCardId(card)}:battle-mastery-choice`,
      condition: { kind: "always" },
      effects: chooserEffects,
      actions: chooserEffects,
      choices: [{
        ...modeChoice,
        options: branches.map((branch) => ({ id: branch.id, label: branch.label })),
      }],
    };
    const branchInstructions: RuleInstruction[] = branches.map((branch) => {
      const effects = parseAtomicEffects(card, branch.text);
      const actions: RuleAction[] = effects.length ? effects : [{ kind: "sequence", effects: [] }];
      return {
        id: `${ruleCardId(card)}:${branch.id}`,
        condition: { kind: "mode-selected", mode: branch.id },
        effects: actions,
        actions,
        choices: choicesForText(card, branch.text, "resolve").filter((candidate) => candidate.id !== "mode"),
        sourceText: branch.text,
      };
    });
    instructions.splice(index, 1, chooser, ...branchInstructions);
    index += branchInstructions.length;
  }

  // A later “play that card” clause reuses a selection made in the previous
  // sentence. Carry the selected hidden-zone owner forward without encoding a
  // printing ID in the executor.
  for (let index = 1; index < instructions.length; index += 1) {
    const current = instructions[index];
    if (!/play that card for free/i.test(current.sourceText)) continue;
    const selected = instructions[index - 1].choices.find((candidate) => candidate.id === "handCardIds");
    if (!selected) continue;
    current.effects = current.effects.map((effect) => (
      effect.kind === "play" ? { ...effect, sourceOwner: selected.owner ?? selected.targetOwner ?? "controller" } : effect
    ));
    current.actions = current.effects;
  }

  // A sentence-ending "instead" clause replaces the immediately preceding
  // effect. Detect that grammar directly so every set receives the same rules
  // treatment and prose such as "instead of [B]" is left alone.
  for (let index = 1; index < instructions.length; index += 1) {
    const current = instructions[index];
    if (current.condition.kind === "always" || !/\binstead\s*\.?\s*$/i.test(current.sourceText)) continue;
    const previous = instructions[index - 1];
    const replacementText = current.sourceText.replace(/\s*\binstead\s*\.?\s*$/i, "");
    const triggerEffects = previous.effects.filter((effect) => effect.kind === "trigger");
    const baseEffects = previous.effects.filter((effect) => effect.kind !== "trigger");
    const effects: RuleAction[] = [...triggerEffects, {
      kind: "conditional",
      condition: current.condition,
      whenTrue: parseAtomicEffects(card, replacementText.replace(
        /^Trifecta:\s*If your Bakugan have three or more BakuCores? (?:attached|attaced) to them\s*[,;:]\s*/i,
        "",
      )),
      whenFalse: baseEffects,
      replacement: true,
    }];
    const sourceText = `${previous.sourceText} ${current.sourceText}`;
    instructions.splice(index - 1, 2, {
      ...previous,
      condition: { kind: "always" },
      effects,
      actions: effects,
      choices: choicesForText(card, sourceText, "resolve"),
      sourceText,
    });
    index -= 1;
  }
  return instructions;
}

function choice(
  id: keyof CardChoices,
  timing: ChoiceSpec["timing"],
  selector: ChoiceSpec["selector"],
  label: string,
  optional = false,
  chooser: ChoiceSpec["chooser"] = "controller",
  visibility: ChoiceSpec["visibility"] = "public",
): ChoiceSpec {
  return { id, timing, selector, label, optional, chooser, visibility, minimum: optional ? 0 : 1, maximum: 1 };
}

function syncChoiceForText(text: string, timing: ChoiceSpec["timing"]): ChoiceSpec | undefined {
  if (timing !== "resolve") return undefined;
  const sync = text.match(/\bSync:\s*(.+)$/i)?.[1];
  if (!sync) return undefined;
  const optional = /\bmay\b/i.test(sync);
  const selected = choice("syncCardId", timing, "hand-card", "Choose a card to reveal for Sync", optional, "controller", "private");
  const cardType = sync.match(/reveal\s+(?:a|an)\s+(Action|Flip Hero|Flip|Hero|Evo|Character|Baku-Gear)\b/i)?.[1] as GameCard["type"] | undefined;
  if (cardType) selected.cardType = cardType;
  const exactCost = sync.match(/costs?\s+(\d+)\s+\[Energy\](?!\s+or\s+more)/i)?.[1];
  const minimumCost = sync.match(/costs?\s+(\d+)\s+\[Energy\]\s+or\s+more/i)?.[1];
  if (minimumCost) selected.minimumCost = Number(minimumCost);
  else if (exactCost) {
    selected.minimumCost = Number(exactCost);
    selected.maximumCost = Number(exactCost);
  }
  if (/same name as the card you played/i.test(sync)) selected.sameNameAsEvent = true;
  return selected;
}

function choicesForText(card: GameCard, text: string, defaultTiming: ChoiceSpec["timing"]): ChoiceSpec[] {
  const result: ChoiceSpec[] = [];
  const syncChoice = syncChoiceForText(text, defaultTiming);
  if (syncChoice) result.push(syncChoice);
  const cardId = ruleCardId(card);
  const timing = /when you play this|\bmay\b|\bSacrifice\b/i.test(text) ? "resolve" : defaultTiming;
  const targetTiming = /\bBattle Mastery\b|when this opens|\bVictor\s*[-:]|\bUnderdog\s*:|at (?:the )?end of (?:your |the )?turn/i.test(text)
    ? "resolve"
    : defaultTiming;
  const discardPaysPlayCost = /\bdiscard\s+(?:a|an|one|two|three|\d+)\s+cards?\s+to play this for free\b/i.test(text);
  const takeControlHero = /take control of a hero/i.test(text);
  const targetOwner = takeControlHero || /enemy|opposing|\bopponent\b/i.test(text)
    ? "opponent" as const
    : /(?:one of )?your (?:open )?(?:Bakugan|Hero|Evo|Energy)/i.test(text)
      ? "controller" as const
      : "any" as const;
  const maximumCost = Number(text.match(/costs? (\d+) \[Energy\] or less/i)?.[1] ?? Number.NaN);
  const printedMaximum = Number.isFinite(maximumCost) ? maximumCost : undefined;
  const attachedCoreTypes = singleAttachedCoreTypes(text);
  const attachesCore = /\battach\s+(?:an?\s+)?(?:additional\s+|another\s+)?bakucore/i.test(text) || attachedCoreTypes.length > 0;
  const coreAttachmentTarget = attachesCore
    && /\bto\s+(?:one of\s+)?(?:your\s+)?(?:an?\s+)?(?:open\s+)?Bakugan\b/i.test(text);
  const explicitBakuganTarget = /choose (?:a|an|one|another)(?:(?!\bplayer\b)[^.;])*?Bakugan|target .*Bakugan|retract (?:(?:one of|another) )?(?:your )?(?:open )?Bakugan|give (?:a|an|one|another)(?: \[[^\]]+\])? Bakugan|(?:a|an|one|another)(?: \[[^\]]+\])? Bakugan gets?|to (?:a|an|one) \[(?:Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\] Bakugan|attach (?:this|(?:an?|one) (?:opposing )?Baku-Gear) (?:to|on) [^.;]*Bakugan/i.test(text)
    || coreAttachmentTarget;
  const separateEvoEffectTarget = card.type === "Evo"
    && defaultTiming === "announce"
    && /when you play this/i.test(text)
    && explicitBakuganTarget
    && cardId !== "aa-99";

  if (card.type === "Evo" && defaultTiming === "announce") {
    const selected = choice(
      separateEvoEffectTarget ? "sourceBakuganId" : "targetBakuganId",
      "announce",
      "chosen-bakugan",
      "Choose the matching Character",
    );
    selected.owner = "controller";
    selected.targetOwner = selected.owner;
    result.push(selected);
  }

  const negateMatch = text.match(/negate (?:a|an) (Hero or Action|Action|Hero|Baku-Gear)(?: card)?/i);
  if (negateMatch) {
    const selected = choice("targetEffectId", defaultTiming, "batch-object", "Choose the card effect to negate");
    selected.cardTypes = /Hero or Action/i.test(negateMatch[1])
      ? ["Hero", "Action"]
      : [negateMatch[1] as GameCard["type"]];
    selected.objectKinds = ["card"];
    selected.owner = "opponent";
    selected.targetOwner = selected.owner;
    selected.maximumCost = printedMaximum;
    result.push(selected);
  }
  if (!negateMatch && /(?:destroy|return|choose|take control)[^.;]*Baku-Gear/i.test(text)) {
    const selected = choice("targetCardId", targetTiming, "card-in-play", "Choose a Baku-Gear");
    selected.cardTypes = ["Baku-Gear"];
    selected.owner = /your Baku-Gear/i.test(text) ? "controller" : targetOwner;
    selected.targetOwner = selected.owner;
    result.push(selected);
  }

  if (/copy the effect of an Action card that was discarded this turn/i.test(text)) {
  const selected = choice("targetCardId", targetTiming, "discarded-card-this-turn", "Choose an Action discarded this turn");
  selected.cardTypes = ["Action"];
  selected.owner = "any";
  selected.targetOwner = selected.owner;
  result.push(selected);
} else if (!negateMatch && /copy (?:the effect of )?an? Action card|copy an? Action card(?:'s|’s) effect/i.test(text)) {
  const selected = choice("targetEffectId", targetTiming, "batch-object", "Choose an Action effect to copy");
  selected.cardTypes = ["Action"];
  selected.objectKinds = ["card", "copy"];
  selected.owner = "any";
  selected.targetOwner = selected.owner;
  result.push(selected);
}

  if (cardId === "aa-50") {
    const enemy = choice("targetBakuganId", "announce", "chosen-bakugan", "Choose the enemy Bakugan");
    enemy.owner = "opponent";
    enemy.targetOwner = enemy.owner;
    const friendly = choice("secondaryTargetBakuganId", "announce", "chosen-bakugan", "Choose one of your Bakugan");
    friendly.owner = "controller";
    friendly.targetOwner = friendly.owner;
    result.push(enemy, friendly);
  } else if (explicitBakuganTarget && (cardId !== "aa-99" || defaultTiming === "resolve")) {
    const selected = choice("targetBakuganId", targetTiming, "chosen-bakugan", "Choose a Bakugan");
    selected.owner = /attach (?:this|(?:an?|one) (?:opposing )?Baku-Gear) (?:to|on) [^.;]*\bone of your\s+Bakugan/i.test(text)
      ? "controller"
      : targetOwner;
    selected.targetOwner = selected.owner;
    if (/open Bakugan/i.test(text) || attachesCore || card.type === "Baku-Gear" || /attach .*Baku-Gear/i.test(text)) selected.openState = "open";
    if (/didn['’]?t open this turn|did not open this turn/i.test(text)) selected.notOpenedThisTurn = true;
    if (/another open Bakugan/i.test(text)) selected.excludeSourceBakugan = true;
    const faction = text.match(/(?:choose|give|to|target)\s+(?:a|an|one|another)?\s*\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]\s+Bakugan/i)?.[1]
      ?? text.match(/\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]\s+Bakugan\s+gets?/i)?.[1];
    if (faction) selected.factions = [faction as GameCard["faction"]];
    result.push(selected);
  }
  if (/choose a player/i.test(text)) result.push(choice("targetPlayerId", timing, "player", "Choose a player"));
  if (!/destroy all/i.test(text) && /destroy a hero|choose a hero|take control of a hero/i.test(text)) {
    const selected = choice("targetHeroId", targetTiming, "hero", "Choose a Hero");
    selected.owner = takeControlHero ? "opponent" : targetOwner;
    selected.targetOwner = selected.owner;
    selected.maximumCost = printedMaximum;
    result.push(selected);
  }
  if (!/destroy all/i.test(text) && /destroy an evo|choose an evo/i.test(text)) {
    const selected = choice("targetEvoId", targetTiming, "evo", "Choose an Evo");
    selected.owner = targetOwner;
    selected.targetOwner = selected.owner;
    selected.notPlayedThisTurn = /not played this turn/i.test(text);
    result.push(selected);
  }
  if (!/destroy all/i.test(text) && /destroy (?:an?|two|three) (?:enemy )?energy|choose an energy/i.test(text)) {
    const selected = choice("targetEnergyIds", targetTiming, "energy-card", "Choose Energy");
    selected.owner = targetOwner;
    selected.targetOwner = selected.owner;
    const amountText = text.match(/destroy (an?|one|two|three|\d+) (?:enemy )?energy/i)?.[1]?.toLowerCase();
    const amount = amountText === "two" ? 2 : amountText === "three" ? 3 : Number(amountText) || 1;
    selected.minimum = cardId === "bb-97" ? 1 : amount;
    selected.maximum = cardId === "bb-97" ? 2 : amount;
    result.push(selected);
  }
  const unchargeChoice = text.match(/\buncharge\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+Energy cards?\b/i);
  if (unchargeChoice) {
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const amount = words[unchargeChoice[1].toLowerCase()] ?? Math.max(1, Number(unchargeChoice[1]) || 1);
    const selected = choice("targetEnergyIds", "resolve", "energy-card", `Choose ${amount} charged Energy cards`);
    selected.owner = targetOwner;
    selected.targetOwner = selected.owner;
    selected.energyState = "charged";
    selected.minimum = amount;
    selected.maximum = amount;
    result.push(selected);
  }
  const rechargeChoice = text.match(/\brecharge\s+up to\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+Energy cards?\b/i);
  if (rechargeChoice) {
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const amount = words[rechargeChoice[1].toLowerCase()] ?? Math.max(1, Number(rechargeChoice[1]) || 1);
    const selected = choice("targetEnergyIds", "resolve", "energy-card", `Choose up to ${amount} uncharged Energy cards`, true);
    selected.owner = "controller";
    selected.targetOwner = selected.owner;
    selected.energyState = "uncharged";
    selected.minimum = 0;
    selected.maximum = amount;
    result.push(selected);
  }

const swapsBakucore = /\bswap\b[^.]*BakuCores?/i.test(text) && /opposing Bakugan/i.test(text);
if (swapsBakucore) {
  const left = choice("coreCell", timing, "bakucore", "Choose a BakuCore to swap");
  left.owner = "controller";
  left.targetOwner = left.owner;
  left.attachmentState = "attached";
  left.attachedToBakugan = /this Bakugan(?:['’]s)?/i.test(text) ? "source-bakugan" : "controller-active";
  const right = choice("secondaryCoreCell", timing, "bakucore", "Choose the opposing BakuCore to swap");
  right.owner = "opponent";
  right.targetOwner = right.owner;
  right.attachmentState = "attached";
  right.attachedToBakugan = "opponent-active";
  result.push(left, right);
}
  if (!/\ball BakuCores?\b|remove all BakuCores?/i.test(text)
    && (attachesCore || /remove .*bakucore|choose a bakucore|turn a bakucore/i.test(text))) {
    const selected = choice("coreCell", targetTiming, "bakucore", "Choose a BakuCore");
    // Cores on the Field are shared game objects; words such as "your" in an
    // attachment effect qualify the Bakugan target, not ownership of the Core.
    selected.owner = attachesCore ? "any" : targetOwner;
    selected.targetOwner = selected.owner;
    selected.attachmentState = attachesCore || /turn .*face up/i.test(text)
      ? "unattached"
      : /remove|return .*field face down/i.test(text) ? "attached" : undefined;
    if (attachedCoreTypes.length) selected.coreTypes = attachedCoreTypes;
    result.push(selected);
  }
  if (/choose a non-energy card in play/i.test(text)) {
    const selected = choice("targetCardId", targetTiming, "card-in-play", "Choose a non-Energy card in play");
    selected.owner = targetOwner;
    selected.targetOwner = selected.owner;
    result.push(selected);
  }
  if (/shuffle any number of cards from your hand into your deck/i.test(text)) {
    const selected = choice("handCardIds", "resolve", "hand-card", "Choose cards to shuffle into your deck", true, "controller", "private");
    selected.owner = "controller";
    selected.targetOwner = selected.owner;
    selected.minimum = 0;
    selected.maximum = 99;
    result.push(selected);
  }
  if (/\bsacrifice\b|\bdiscards?\s+(?:a|an|one|two|three|any|up to|\d+)(?:\s+(?:Action|Evo|Flip|Hero|Character))?\s+cards?\b|\bdiscards?\s+cards?\s+from your hand\b/i.test(text)
    && !discardPaysPlayCost
    && !/choose a player to discard/i.test(text)
    && !(/if you open on the Reroll/i.test(text) && /\bVictor\s*:/i.test(text))) {
    const optional = /up to|any number|may discard/i.test(text);
    const eachPlayerChooses = /\beach player\b|\ball players\b|\bboth players\b/i.test(text);
    const opponentOwnsZone = /opponent(?:'s|’s)\s+hand|opponent\s+(?:(?:may|must)\s+)?discards?/i.test(text);
    const opponentChooses = /(?:your\s+)?opponent\s+(?:(?:may|must)\s+)?discards?/i.test(text);
    const selected = choice(
      "discardCardIds",
      "resolve",
      "hand-card",
      /sacrifice/i.test(text) ? "Choose cards to sacrifice" : "Choose cards to discard",
      optional,
      eachPlayerChooses ? "each-player" : opponentChooses ? "opponent" : "controller",
      "private",
    );
    selected.owner = eachPlayerChooses ? "chooser" : opponentOwnsZone ? "opponent" : "controller";
    selected.targetOwner = selected.owner;
    const typedDiscard = text.match(/\bdiscards?\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(Action|Evo|Flip|Hero|Character)\s+cards?/i);
    if (typedDiscard) {
      const normalizedType = `${typedDiscard[1][0].toUpperCase()}${typedDiscard[1].slice(1).toLowerCase()}` as GameCard["type"];
      selected.cardTypes = [normalizedType];
    }
    const printedAmount = text.match(/\bdiscards?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)(?:\s+(?:Action|Evo|Flip|Hero|Character))?\s+cards?/i)?.[1];
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const amount = printedAmount ? words[printedAmount.toLowerCase()] ?? Number(printedAmount) : 1;
    selected.minimum = optional ? 0 : amount;
    selected.maximum = /any number/i.test(text) ? 99 : Math.max(1, amount);
    result.push(selected);
  }
  const energizeFromHand = text.match(/\benergize\s+(?:(a|an|one|two|three|\d+)\s+)?cards?\s+(?:in|from)\s+your\s+hand\b/i);
  if (energizeFromHand) {
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3 };
    const printed = energizeFromHand[1]?.toLowerCase();
    const amount = printed ? words[printed] ?? Math.max(1, Number(printed) || 1) : 1;
    const opponentChooses = /\byour opponent may Energize\b/i.test(text);
    const selected = choice(
      "handCardIds",
      "resolve",
      "hand-card",
      `Choose ${amount === 1 ? "a card" : `${amount} cards`} to Energize`,
      false,
      opponentChooses ? "opponent" : "controller",
      "private",
    );
    selected.owner = "controller";
    selected.targetOwner = "controller";
    selected.minimum = amount;
    selected.maximum = amount;
    result.push(selected);
  }
  if (/Energize any number of cards in your hand/i.test(text)) {
    const selected = choice("handCardIds", "resolve", "hand-card", "Choose any number of cards to Energize", true, "controller", "private");
    selected.owner = "controller";
    selected.targetOwner = "controller";
    selected.minimum = 0;
    selected.maximum = 99;
    result.push(selected);
  }
  const keepEnergy = text.match(/both players must destroy all but (one|two|three|four|five|\d+) Energy cards they have/i);
  if (keepEnergy) {
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    const amount = words[keepEnergy[1].toLowerCase()] ?? Number(keepEnergy[1]);
    const selected = choice("targetEnergyIds", "resolve", "energy-card", `Choose ${amount} Energy cards to keep`, false, "each-player", "secret-until-reveal");
    selected.owner = "chooser";
    selected.targetOwner = "chooser";
    selected.minimum = amount;
    selected.maximum = amount;
    selected.onlyIfAvailableMoreThan = amount;
    result.push(selected);
  }
  if (/search your deck/i.test(text)) result.push(choice("deckCardId", timing, "deck-card", "Choose a card from your deck", false, "controller", "private"));
  if (/top .*cards?.*any order/i.test(text)) result.push(choice("orderedCardIds", timing, "deck-card", "Order the revealed cards", false, "controller", "private"));
  const persistentFreePermission = /for the rest of the turn,\s*both players may play Evo cards from their hand for free/i.test(text);
  const freeFactionPlay = text.match(/play\s+an?\s+\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]\s+card(?:\s+(?:with cost|that costs?)\s+(\d+)\s+\[Energy\]\s+or less)?\s+for free/i);
  if (freeFactionPlay) {
    const selected = choice("handCardIds", "resolve", "hand-card", "Choose a card to play", false, "controller", "private");
    selected.factions = [freeFactionPlay[1] as GameCard["faction"]];
    if (freeFactionPlay[2]) selected.maximumCost = Number(freeFactionPlay[2]);
    selected.owner = "controller";
    selected.targetOwner = selected.owner;
    selected.playForFree = true;
    result.push(selected);
  }
  const namedFreePlay = !freeFactionPlay
    ? text.match(/play\s+\[([A-Za-z]+)\]\s+([A-Za-z][A-Za-z0-9'’ -]*?)\s+for free/i)
    : null;
  if (namedFreePlay) {
    const selected = choice("handCardIds", "resolve", "hand-card", "Choose the named card to play", false, "controller", "private");
    selected.cardName = `${namedFreePlay[1]} ${namedFreePlay[2].trim()}`;
    selected.owner = "controller";
    selected.targetOwner = selected.owner;
    selected.playForFree = true;
    result.push(selected);
  }
  if (/play a Rapid Fire in your discard pile for free/i.test(text)) {
    const selected = choice("discardCardIds", "resolve", "discard-card", "Choose a Rapid Fire card from your discard pile", false, "controller", "private");
    selected.cardMechanic = "Rapid Fire";
    selected.owner = "controller";
    selected.targetOwner = "controller";
    selected.playForFree = true;
    result.push(selected);
  }
  const chosenOpponentAction = /look at your opponent(?:'s|’s) hand and choose an Action card/i.test(text);
  if (chosenOpponentAction) {
    const selected = choice("handCardIds", "resolve", "hand-card", "Choose an Action card from your opponent's hand", false, "controller", "private");
    selected.cardType = "Action";
    selected.owner = "opponent";
    selected.targetOwner = selected.owner;
    result.push(selected);
  }
  const freeHandPlay = text.match(/play\s+(?:an?|the)?\s*(Action|Hero|Evo|card)(?:\s+card)?(?:\s+that costs?\s+(\d+)\s+\[Energy\]\s+or less)?(?:\s+from\s+(?:your\s+)?hand|\s+from\s+it)?\s+for free|play that Bakugan(?:'s|’s) Evo card for free/i);
  if (freeHandPlay && !persistentFreePermission && !freeFactionPlay && !namedFreePlay) {
    const selected = choice("handCardIds", "resolve", "hand-card", "Choose a card to play", false, "controller", "private");
    if (/that Bakugan(?:'s|’s) Evo/i.test(text)) selected.cardType = "Evo";
    else if (freeHandPlay[1] && freeHandPlay[1].toLowerCase() !== "card") selected.cardType = freeHandPlay[1] as GameCard["type"];
    if (freeHandPlay[2]) selected.maximumCost = Number(freeHandPlay[2]);
    selected.owner = /from it|opponent(?:'s|’s) hand|opponent(?:'s|’s) discard pile/i.test(text) ? "opponent" : "controller";
    selected.targetOwner = selected.owner;
    selected.playForFree = true;
    result.push(selected);
  }
  const paidHandPlay = text.match(/play\s+an?\s+(Action|Hero|Evo)\s+card\s+that costs?\s+(\d+)\s+\[Energy\]\s+or less(?!\s+for free)/i);
  if (paidHandPlay) {
    const selected = choice("handCardIds", "resolve", "hand-card", `Choose a ${paidHandPlay[1]} card to play`, true, "controller", "private");
    selected.cardType = paidHandPlay[1] as GameCard["type"];
    selected.maximumCost = Number(paidHandPlay[2]);
    selected.owner = "controller";
    selected.targetOwner = "controller";
    selected.minimum = 0;
    selected.maximum = 1;
    result.push(selected);
  }
  if (/Battle Mastery:.*Choose one|choose one of the following/i.test(text)) result.push(choice("mode", timing, "mode", "Choose a Battle Mastery mode"));
  else if (/\bChoose one\s*:/i.test(text)) result.push(choice("mode", targetTiming, "mode", "Choose one effect"));
  else if (/For each \[Energy\] used, give a Bakugan \+\d+ \[B\] or \+\d+ \[Damage Rating\]/i.test(text)) result.push(choice("mode", "resolve", "mode", "Choose a scaling bonus"));
  if (card.cost === "X" || /choose (?:a value for )?x/i.test(text)) result.push(choice("xValue", "pay", "number", "Choose X"));
  if ((/\bmay\b/i.test(text) || /\byou can play\b/i.test(text))
    && !persistentFreePermission
    && !/may discard|may recharge up to/i.test(text)
    && !/\bSync:/i.test(text)
    && !syncChoice) {
    const optionalChooser = /\beach player may\b/i.test(text)
      ? "each-player" as const
      : /\byour opponent may\b/i.test(text) ? "opponent" as const : "controller" as const;
    result.push(choice("confirmed", "resolve", "mode", "Use this optional effect?", false, optionalChooser));
  }
  return result.filter((item, index, values) => values.findIndex((candidate) => candidate.id === item.id && candidate.timing === item.timing) === index);
}

function reductionAmountFor(text: string, amount: number): import("./values").NumberValue {
  if (/for each card you (?:have )?played this turn/i.test(text)) return { kind: "product", factors: [amount, { kind: "count", source: "cards-played", owner: "controller" }] };
  if (/for each BakuCore that your Bakugan hold/i.test(text)) return { kind: "product", factors: [amount, { kind: "count", source: "held-bakucore", owner: "controller" }] };
  if (/for each Baku-Gear attached to\s+(?:this|your)/i.test(text)) return {
    kind: "product",
    factors: [amount, {
      kind: "property",
      subject: { kind: "bakugan", selector: "source" },
      property: "baku-gear-count",
    }],
  };
  return amount;
}

function costModifiersFor(card: GameCard): CostEffect[] {
  const result: CostEffect[] = [];
  const text = card.effect;
  const selfPlayCostDuration = /\bTrifecta:/i.test(text) ? "instant" as const : durationFor(text);
  const discardForFree = text.match(/(?:Sacrifice\s*[-:]\s*)?You may discard (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? to play this for free/i);
  if (discardForFree) {
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const amount = words[discardForFree[1].toLowerCase()] ?? Math.max(1, Number(discardForFree[1]) || 1);
    result.push({
      kind: "cost-alternative",
      id: `${ruleCardId(card)}:discard-for-free`,
      label: `Sacrifice — discard ${amount} card${amount === 1 ? "" : "s"}`,
      setsBaseFree: true,
      components: [{ kind: "cost-discard", amount, choiceId: "discardCardIds" }],
    });
  }

  // A card's own play-cost adjustment must explicitly name "this". Static
  // reducers such as Shun, Lightning, and Strata target cards played later and
  // are evaluated from their active Hero source by the cost calculator.
  for (const match of text.matchAll(/\bthis\s+costs?\s+(\d+)\s+\[Energy\]\s+less(?:\s+to\s+(?:play|use))?(?:\s+for\s+each\s+[^.]+)?/gi)) {
    result.push({
      kind: "cost-reduce",
      amount: reductionAmountFor(match[0], Number(match[1])),
      duration: "instant",
      condition: conditionFor(text),
      appliesTo: "self",
    });
  }

  const controlledCardReduction = text.match(/\b(?:your\s+)?(Action|Hero|Flip)\s+cards?\s+cost(?:\s+you)?\s+(\d+)\s+\[Energy\]\s+less\b/i);
  if (controlledCardReduction) {
    result.push({
      kind: "cost-reduce",
      amount: Number(controlledCardReduction[2]),
      duration: "while-source-active",
      cardType: controlledCardReduction[1] as GameCard["type"],
      appliesTo: "controller",
    });
  }
  const controlledEvoReduction = text.match(/\bEvos?\s+cost(?:\s+you)?\s+(\d+)\s+\[Energy\]\s+less\b/i);
  if (controlledEvoReduction) {
    result.push({
      kind: "cost-reduce",
      amount: Number(controlledEvoReduction[1]),
      duration: "while-source-active",
      cardType: "Evo",
      appliesTo: "controller",
    });
  }

  const rapidFireCondition = (operator: ">=" | "==", right: number): RuleCondition => ({
    kind: "expression",
    expression: {
      kind: "compare-number",
      left: { kind: "count", source: "cards-played-with-mechanic", owner: "controller", mechanic: "Rapid Fire" },
      operator,
      right,
    },
  });
  if (/\bRapid Fire:\s*The second Rapid Fire card you play this turn\s+(?:is|can be) free|\bRapid Fire:\s*The second Rapid Fire card you play this turn for free/i.test(text)) {
    result.push({
      kind: "cost-free",
      duration: "turn",
      cardMechanic: "Rapid Fire",
      condition: rapidFireCondition("==", 1),
    });
  }
  if (/\b(?:Rapid Fire:\s*)?The third Rapid Fire card you play (?:each turn|this turn)\s+(?:is|can be) free|\b(?:Rapid Fire:\s*)?The third Rapid Fire card you play (?:each turn|this turn) for free/i.test(text)) {
    result.push({
      kind: "cost-free",
      duration: "turn",
      cardMechanic: "Rapid Fire",
      condition: rapidFireCondition(">=", 2),
    });
  }

  const optionalSelfFree = !discardForFree && /you may play this(?: card)? for free/i.test(text);
  if (optionalSelfFree) {
    result.push({
      kind: "cost-alternative",
      id: `${ruleCardId(card)}:self-free`,
      label: "Play for free",
      setsBaseFree: true,
      components: [],
      condition: conditionFor(text),
    });
  } else if (!discardForFree && /play this for free|this is free/i.test(text)) {
    result.push({ kind: "cost-free", duration: selfPlayCostDuration, condition: conditionFor(text) });
  }
  if (ruleCardId(card) === "aa-112") {
    result.push({ kind: "cost-alternative", id: "aa-112:discard-two", label: "Discard two cards instead of paying the printed Energy cost", setsBaseFree: true, components: [{ kind: "cost-discard", amount: 2, choiceId: "discardCardIds" }] });
  }
  return result;
}

function evoIdentities(card: GameCard): RulesCardId[] {
  if (card.type !== "Evo" || !card.evolvesFrom) return [];
  const normalize = (value: string) => value
    .replace(/\s*\(Battle Brawlers\)\s*$/i, "")
    .replace(/^(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\s+/i, "")
    .replace(/\bSerpeteze\b/gi, "Serpenteze")
    .replace(/\s+/g, " ").trim().toLowerCase();
  const inferred = normalize((card.displayName || card.name).replace(/^(Diamond|Hyper|Titan|Maximus)\s+/i, ""));
  const declared = normalize(card.evolvesFrom ?? "");
  const setPrefix = ruleCardId(card).split("-")[0];
  const candidates = CARDS.filter((candidate) => candidate.type === "Character"
    && [declared, inferred].includes(normalize(candidate.displayName || candidate.name))
    && (card.factions?.length ? card.factions.includes(candidate.faction) : candidate.faction === card.faction));
  const sameSet = candidates.filter((candidate) => ruleCardId(candidate).startsWith(`${setPrefix}-`));
  return (sameSet.length ? sameSet : candidates).slice(0, 1).map((candidate) => ruleCardId(candidate));
}

export function playDefinitionForCard(card: GameCard): CardPlayDefinition {
  // Quoted abilities are granted to the permanent; their optional choices do
  // not belong to the card's enter-play announcement.
  const announcementText = card.effect.replace(/["“]Victor\s*:[\s\S]*?["”]/gi, "");
  const choices = choicesForText(card, announcementText, "announce");
  if (card.type === "Baku-Gear") {
    let target = choices.find((candidate) => candidate.id === "targetBakuganId");
    if (!target) {
      target = choice("targetBakuganId", "announce", "chosen-bakugan", "Choose a Bakugan for this Baku-Gear");
      choices.push(target);
    }
    target.owner = "controller";
    target.targetOwner = "controller";
    target.openState = "open";
    const faction = card.effect.match(/only play this on an? \[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\] Bakugan/i)?.[1];
    if (faction) target.factions = [faction as GameCard["faction"]];
  }
  // A later trigger on the same card must not move a When-you-play target
  // from announcement to resolution. Parse each When-you-play clause in
  // isolation and merge its announcement selections into the card play.
  for (const match of card.effect.matchAll(/when you play this[\s\S]*?(?=\b(?:when this opens|Victor|Underdog|at (?:the )?end of (?:your |the )?turn)\s*[-:]|$)/gi)) {
    for (const selected of choicesForText(card, match[0], "announce").filter((choice) => choice.timing === "announce")) {
      if (!choices.some((choice) => choice.id === selected.id && choice.timing === selected.timing)) choices.push(selected);
    }
  }
  return {
    choices,
    costModifiers: costModifiersFor(card),
    evolvesFrom: evoIdentities(card),
    sourceZones: card.type === "Flip" || card.type === "Flip Hero"
      ? ["damage-reveal"]
      : /play this from your discard pile as though it were in your hand/i.test(card.effect)
        ? ["hand", "discard"]
        : ["hand"],
  };
}

function cardEntryInstruction(card: GameCard, trigger: RuleInstruction): RuleInstruction {
  const sourceText = trigger.sourceText.split(/[,;:]/, 1)[0]?.trim() || trigger.sourceText;
  const effects: RuleAction[] = [{ kind: "sequence", effects: [] }];
  return {
    id: `${ruleCardId(card)}:enter-play`,
    condition: { kind: "always" },
    effects,
    actions: effects,
    choices: [],
    sourceText,
  };
}

export function abilityDefinitionsForCard(card: GameCard): AbilityDefinition[] {
  const normalizedText = card.effect.replace(/\s+/g, " ").trim();
  const grantedVictor = normalizedText.match(
    /^(If you play cards from (?:no|a|an|one|two|three|four|five|six|\d+) different Factions in the same turn),\s*(this gets [\s\S]+?)\s+and\s+["“]Victor\s*:\s*([\s\S]+?)["”]\.?$/i,
  );
  if (grantedVictor) {
    const conditionText = grantedVictor[1];
    const staticText = `${conditionText}, ${grantedVictor[2].replace(/[,.]\s*$/, "")}.`;
    const victorText = `Victor: ${grantedVictor[3].replace(/[,.]\s*$/, "")}.`;
    const staticInstructions = splitInstructions(card, staticText);
    const victorInstructions = splitInstructions(card, victorText);
    const condition = conditionFor(conditionText);
    const trigger = victorInstructions[0]?.effects.find(
      (effect): effect is Extract<RuleAction, { kind: "trigger" }> => effect.kind === "trigger",
    );
    if (trigger) trigger.definition.interveningCondition = condition;
    return [
      { id: `${ruleCardId(card)}:spell`, kind: "spell", instructions: staticInstructions },
      {
        id: `${ruleCardId(card)}:trigger:1`,
        kind: "triggered",
        trigger: trigger?.definition,
        instructions: victorInstructions,
      },
    ];
  }
  const instructions = splitInstructions(card, card.effect);
  const triggered: RuleInstruction[][] = [];
  const ordinary: RuleInstruction[] = [];
  let activeTrigger: RuleInstruction[] | undefined;
  for (const instruction of instructions) {
    const startsTrigger = instruction.condition.kind !== "reroll-opened"
      && instruction.effects.some((effect) => effect.kind === "trigger");
    if (startsTrigger) {
      activeTrigger = [instruction];
      triggered.push(activeTrigger);
      continue;
    }
    // Sentence splitting must not turn a follow-up clause into an enter-play
    // spell. These phrases refer to information or an action created by the
    // preceding trigger and therefore share that trigger's event timing.
    const continuesTrigger = Boolean(activeTrigger) && (
      instruction.condition.kind === "mode-selected"
      || /^(?:then\b|shuffle\s+your\s+deck\b|this\s+gets\b[^.]*\brevealed\s+card\b|you\s+may\s+(?:put|play|attach)\s+(?:it|that\s+card|the\s+(?:chosen|revealed)\s+card|an?\s+\[(?:FT|FF|SD|MS|HE)\])\b|if\s+(?:it(?:['’]?s|\b)|they\b|you do\b|an?\s+[^,.]+\s+cards?\s+is\s+revealed\s+this\s+way\b|one\s+of\s+(?:them|those\s+cards)\b|the\s+revealed\s+card\b))/i.test(
        instruction.sourceText.trim(),
      )
    );
    if (continuesTrigger) activeTrigger!.push(instruction);
    else {
      activeTrigger = undefined;
      ordinary.push(instruction);
    }
  }
  for (let index = 0; index < ordinary.length - 1; index += 1) {
    const current = ordinary[index];
    const followUp = ordinary[index + 1];
    const negateIndex = current.effects.findIndex((effect) => effect.kind === "negate");
    if (negateIndex < 0 || !/\bmay copy (?:its|that card(?:'s|’s)) effect\b/i.test(followUp.sourceText)) continue;
    const negate = current.effects[negateIndex];
    if (negate.kind !== "negate") continue;
    const copiedNegate: RuleAction = { ...negate, copy: true };
    current.effects = current.effects.map((effect, effectIndex) => effectIndex === negateIndex ? copiedNegate : effect);
    current.actions = current.effects;
    if (!current.choices.some((choice) => choice.id === "confirmed")) {
      current.choices.push({
        id: "confirmed",
        timing: "resolve",
        selector: "mode",
        label: "Copy the negated effect?",
        minimum: 1,
        maximum: 1,
        optional: false,
        chooser: "controller",
        visibility: "public",
      });
    }
    current.sourceText = `${current.sourceText} ${followUp.sourceText}`.trim();
    ordinary.splice(index + 1, 1);
  }

  const result: AbilityDefinition[] = [];
  if (["Hero", "Evo"].includes(card.type) && triggered.length && !ordinary.length) {
    result.push({
      id: `${ruleCardId(card)}:spell`,
      kind: "spell",
      instructions: [cardEntryInstruction(card, triggered[0][0])],
    });
  } else if (ordinary.length || !triggered.length) result.push({
    id: `${ruleCardId(card)}:${card.type === "Character" ? "character" : "spell"}`,
    kind: card.type === "Character" ? "character" : card.type === "Hero" && ordinary.some((instruction) => instruction.effects.some((effect) => (
      (effect.kind === "modify-stat" || effect.kind === "grant-keyword") && effect.duration === "while-source-active"
    ))) ? "static" : "spell",
    instructions: ordinary.length ? ordinary : instructions,
  });
  for (const group of triggered) {
    const trigger = group[0].effects.find((effect): effect is Extract<RuleAction, { kind: "trigger" }> => effect.kind === "trigger")!;
    result.push({ id: `${ruleCardId(card)}:trigger:${result.length}`, kind: "triggered", trigger: trigger.definition, instructions: group });
  }
  return result;
}
