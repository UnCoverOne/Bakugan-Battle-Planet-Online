from pathlib import Path

_original_write_text = Path.write_text


def _instrumented_write_text(self: Path, data: str, *args, **kwargs):
    path = self.as_posix()
    if path.endswith("lib/opponentAiBase.ts") and "function expectedPowerResponseContinuation" in data:
        if "AI_CONT_START" not in data:
            data = data.replace(
                '  if (budget <= 0 || !forecast.own || !forecast.opponent) return 0;\n',
                '  console.log("AI_CONT_START", { budget, own: Boolean(forecast.own), opponent: Boolean(forecast.opponent), selected: match.selected });\n'
                '  if (budget <= 0 || !forecast.own || !forecast.opponent) return 0;\n',
                1,
            )
        if "AI_CONT_OPTIONS" not in data:
            data = data.replace(
                '  if (!options.length) return 0;\n',
                '  console.log("AI_CONT_OPTIONS", options);\n'
                '  if (!options.length) return 0;\n',
                1,
            )
        if "AI_PRE_ROLL_SCORE" not in data:
            data = data.replace(
                '  let score = baseScore - energyOpportunityCost;\n',
                '  console.log("AI_PRE_ROLL_SCORE", { card: card.catalogId, baseScore, passContinuation: context.passContinuation, continuationAfter, energyOpportunityCost, remainingCapacity });\n'
                '  let score = baseScore - energyOpportunityCost;\n',
                1,
            )
    return _original_write_text(self, data, *args, **kwargs)


Path.write_text = _instrumented_write_text
