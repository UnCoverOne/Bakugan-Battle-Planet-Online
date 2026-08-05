import builtins
import os


class Path:
    def __init__(self, value):
        self.value = os.fspath(value)

    def as_posix(self):
        return self.value.replace(os.sep, "/")

    def read_text(self, encoding="utf-8"):
        with builtins.open(self.value, "r", encoding=encoding) as handle:
            return handle.read()

    def write_text(self, data, encoding="utf-8"):
        if self.as_posix().endswith("lib/opponentAiBase.ts") and "function expectedPowerResponseContinuation" in data:
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
        with builtins.open(self.value, "w", encoding=encoding) as handle:
            return handle.write(data)

    def open(self, mode="r", encoding="utf-8"):
        return builtins.open(self.value, mode, encoding=encoding)
