from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content)


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, got {count}: {old[:100]!r}")
    write(path, content.replace(old, new, 1))


# Keep the old targetOwner field populated during the ownership-model migration.
# Runtime resolution prefers owner, while older tests/data consumers remain stable.
path = "lib/rules/catalogue-structure.ts"
content = read(path)
lines = content.splitlines()
out = []
for index, line in enumerate(lines):
    out.append(line)
    match = re.match(r"(\s*)([A-Za-z_$][\w$]*)\.owner = (.+);$", line)
    if match:
        indent, variable, _ = match.groups()
        mirror = f"{indent}{variable}.targetOwner = {variable}.owner;"
        if index + 1 >= len(lines) or lines[index + 1].strip() != mirror.strip():
            out.append(mirror)
write(path, "\n".join(out) + "\n")

# A follow-up sentence that says to copy "its effect" refers to the immediately
# preceding negate target. Fold that relation structurally so the existing
# negate operation can copy the exact removed batch object and still honor May.
needle = '''  const result: AbilityDefinition[] = [];\n'''
insert = '''  for (let index = 0; index < ordinary.length - 1; index += 1) {\n    const current = ordinary[index];\n    const followUp = ordinary[index + 1];\n    const negateIndex = current.effects.findIndex((effect) => effect.kind === "negate");\n    if (negateIndex < 0 || !/\\bmay copy (?:its|that card(?:'s|’s)) effect\\b/i.test(followUp.sourceText)) continue;\n    const negate = current.effects[negateIndex];\n    if (negate.kind !== "negate") continue;\n    const copiedNegate: RuleAction = { ...negate, copy: true };\n    current.effects = current.effects.map((effect, effectIndex) => effectIndex === negateIndex ? copiedNegate : effect);\n    current.actions = current.effects;\n    if (!current.choices.some((choice) => choice.id === "confirmed")) {\n      current.choices.push({\n        id: "confirmed",\n        timing: "resolve",\n        selector: "mode",\n        label: "Copy the negated effect?",\n        minimum: 1,\n        maximum: 1,\n        optional: false,\n        chooser: "controller",\n        visibility: "public",\n      });\n    }\n    current.sourceText = `${current.sourceText} ${followUp.sourceText}`.trim();\n    ordinary.splice(index + 1, 1);\n  }\n\n  const result: AbilityDefinition[] = [];\n'''
replace_once(path, needle, insert)

# Keep the regression focused on semantic output rather than requiring the
# sentence combiner to have been the exact normalization path.
test_path = "tests/rules-primitives.test.ts"
tests = read(test_path)
tests = tests.replace(
    '  const instruction = definition.abilities.flatMap((ability) => ability.instructions)\n    .find((candidate) => /Negate an Action card.*copy its effect/i.test(candidate.sourceText));\n',
    '  const instruction = definition.abilities.flatMap((ability) => ability.instructions)\n    .find((candidate) => candidate.effects.some((effect) => effect.kind === "negate" && effect.copy));\n',
)
write(test_path, tests)

print("Applied compatibility mirrors and adjacent negate-copy folding.")
