export type SyncIndicatorTone = "synced" | "working" | "warning" | "error";

export type SyncIndicator = {
  tone: SyncIndicatorTone;
  title: string;
};

export function hasClientVersionMismatch(
  clientBuildId: string,
  serverBuildId: string,
) {
  return Boolean(
    clientBuildId &&
      serverBuildId &&
      clientBuildId !== "development" &&
      serverBuildId !== "development" &&
      clientBuildId !== serverBuildId,
  );
}

export function deriveSyncIndicator({
  authenticated,
  syncStatus,
  storageStatus,
  storageMessage,
}: {
  authenticated: boolean;
  syncStatus: string;
  storageStatus: string;
  storageMessage: string;
}): SyncIndicator {
  if (!authenticated) {
    if (storageStatus === "error") {
      return { tone: "error", title: storageMessage };
    }
    if (storageStatus === "checking") {
      return { tone: "working", title: "Checking device storage" };
    }
    return {
      tone: "synced",
      title:
        storageStatus === "saved"
          ? "Saved on this device"
          : "Device data ready",
    };
  }

  switch (syncStatus) {
    case "synced":
      return { tone: "synced", title: "Cloud synced" };
    case "saving":
      return { tone: "working", title: "Saving to cloud" };
    case "offline":
      return { tone: "warning", title: "Offline; sync queued" };
    case "conflict":
      return { tone: "error", title: "Sync conflict; review Settings" };
    case "error":
      return { tone: "error", title: "Cloud sync issue" };
    case "checking":
    case "loading":
    case "local":
    default:
      return { tone: "working", title: "Connecting to cloud" };
  }
}
