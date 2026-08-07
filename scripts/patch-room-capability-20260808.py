from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}: {old!r}; found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "components/application/AppProvider.jsx",
    "replayIndex, setReplayIndex, playerId, matchError, toast",
    "replayIndex, setReplayIndex, playerId, matchCapability, matchError, toast",
)
replace_once(
    "components/application/AppProvider.jsx",
    "online, promptAccount, playerId, requestAccountAccess",
    "online, promptAccount, playerId, matchCapability, requestAccountAccess",
)

replace_once(
    "components/routes/LobbyRoomScreen.tsx",
    "    playerId: appPlayerId,\n    settings,",
    "    playerId: appPlayerId,\n    matchCapability: appMatchCapability,\n    settings,",
)
replace_once(
    "components/routes/LobbyRoomScreen.tsx",
    "      playerId: appPlayerId,\n      settings,",
    "      playerId: appPlayerId,\n      capability: appMatchCapability,\n      settings,",
)
replace_once(
    "components/routes/LobbyRoomScreen.tsx",
    "  }, [appMatch, appOnline, appPlayerId, appReady, settings]);",
    "  }, [appMatch, appMatchCapability, appOnline, appPlayerId, appReady, settings]);",
)

replace_once(
    "components/routes/MatchRuntime.tsx",
    "  const { ready, match, online, playerId, settings } = useApp();",
    "  const { ready, match, online, playerId, matchCapability, settings } = useApp();",
)
replace_once(
    "components/routes/MatchRuntime.tsx",
    "      playerId,\n      settings,",
    "      playerId,\n      capability: matchCapability,\n      settings,",
)
replace_once(
    "components/routes/MatchRuntime.tsx",
    "  }, [match, online, playerId, ready, settings]);",
    "  }, [match, matchCapability, online, playerId, ready, settings]);",
)

replace_once(
    "tests/lobby-flow.test.ts",
    "  const [room, page] = await Promise.all([\n    readFile(new URL(\"../components/routes/LobbyRoomScreen.tsx\", import.meta.url), \"utf8\"),\n    readFile(new URL(\"../app/(workspace)/play/lobby/page.tsx\", import.meta.url), \"utf8\"),\n  ]);",
    "  const [room, page, provider, runtime] = await Promise.all([\n    readFile(new URL(\"../components/routes/LobbyRoomScreen.tsx\", import.meta.url), \"utf8\"),\n    readFile(new URL(\"../app/(workspace)/play/lobby/page.tsx\", import.meta.url), \"utf8\"),\n    readFile(new URL(\"../components/application/AppProvider.jsx\", import.meta.url), \"utf8\"),\n    readFile(new URL(\"../components/routes/MatchRuntime.tsx\", import.meta.url), \"utf8\"),\n  ]);",
)
replace_once(
    "tests/lobby-flow.test.ts",
    "  assert.match(page, /LobbyRoomScreen/);\n  assert.doesNotMatch(page, /MatchRuntime|LobbyScreen/);",
    "  assert.match(page, /LobbyRoomScreen/);\n  assert.doesNotMatch(page, /MatchRuntime|LobbyScreen/);\n\n  // Match capability lives in React state before the debounced sessionStorage write.\n  // Route-local stores must be primed from that live value or room commands can send\n  // the previous room's capability and fail authorization.\n  assert.match(provider, /playerId, matchCapability, matchError/);\n  assert.match(provider, /playerId, matchCapability, requestAccountAccess/);\n  assert.match(room, /matchCapability: appMatchCapability/);\n  assert.match(room, /capability: appMatchCapability/);\n  assert.match(runtime, /playerId, matchCapability, settings/);\n  assert.match(runtime, /capability: matchCapability/);",
)
