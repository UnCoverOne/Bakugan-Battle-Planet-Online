import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Return to Play dismisses the completed-match overlay without leaving gameplay", () => {
  const source = readFileSync(
    new URL("../components/game-screen-v2/MatchStateCoordinator.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const \[dismissedResultKey, setDismissedResultKey\]/);
  assert.match(source, /completed && resultReady && resultKey !== dismissedResultKey/);
  assert.match(source, /if \(matchIsComplete\(match\)\) \{\s*if \(resultKey\) setDismissedResultKey\(resultKey\);\s*return;/);
  assert.match(source, /router\.push\("\/play\/result"\)/);
  assert.doesNotMatch(source, /router\.push\(matchIsComplete\(returnState\.match!\) \? "\/play"/);
});
