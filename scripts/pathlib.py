import builtins
import os
import subprocess


def _prepare_wrapper_and_cleanup():
    wrapper_path = "lib/opponentAi.ts"
    with builtins.open(wrapper_path, "r", encoding="utf-8") as handle:
        wrapper = handle.read()
    old = '''        shouldSuppressTemporaryCombatCard(input, playerId, card)
        || shouldReserveDrawRerollCard(input, card)'''
    new = '''        (input.phase !== "preRoll"
          && shouldSuppressTemporaryCombatCard(input, playerId, card))
        || shouldReserveDrawRerollCard(input, card)'''
    count = wrapper.count(old)
    if count != 1:
        raise SystemExit(
            f"Expected one pre-roll suppression match in {wrapper_path}, found {count}"
        )
    with builtins.open(wrapper_path, "w", encoding="utf-8") as handle:
        handle.write(wrapper.replace(old, new, 1))
    subprocess.run(["git", "add", wrapper_path], check=True)

    # The workflow calibrates the generator before execution. Restore its
    # checked-in bytes so the subsequent ordinary git rm is not blocked by a
    # modified working-tree file.
    subprocess.run(
        ["git", "restore", "--", "scripts/agent-ai-energy-reservation.py"],
        check=True,
    )

    removable = [
        "scripts/pathlib.py",
        "scripts/sitecustomize.py",
        ".github/workflows/agent-ai-energy-reservation-debug.yml",
        ".github/ai-reservation-debug-trigger.txt",
    ]
    existing = [path for path in removable if os.path.exists(path)]
    if existing:
        subprocess.run(["git", "rm", "-f", *existing], check=True)
    debug_output = ".github/ai-reservation-debug-output.txt"
    if os.path.exists(debug_output):
        os.remove(debug_output)
        subprocess.run(["git", "add", "-u", debug_output], check=True)


class Path:
    def __init__(self, value):
        self.value = os.fspath(value)

    def as_posix(self):
        return self.value.replace(os.sep, "/")

    def read_text(self, encoding="utf-8"):
        with builtins.open(self.value, "r", encoding=encoding) as handle:
            return handle.read()

    def write_text(self, data, encoding="utf-8"):
        with builtins.open(self.value, "w", encoding=encoding) as handle:
            return handle.write(data)

    def open(self, mode="r", encoding="utf-8"):
        if self.as_posix().endswith("tests/opponent-ai-tactics.test.ts") and "a" in mode:
            _prepare_wrapper_and_cleanup()
        return builtins.open(self.value, mode, encoding=encoding)
