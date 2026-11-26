import { PERSISTENT_LOBBY_ENABLED, LEGACY_LOBBY_CREATION_CLOSED } from "./lobby-cutover";
import { inspectLegacyRooms } from "./lobby-legacy-reconciliation";
import { ServiceUnavailableError } from "./server-errors";

export async function assertLobbyAdmissionCutover(database:D1Database) {
  if(!PERSISTENT_LOBBY_ENABLED||!LEGACY_LOBBY_CREATION_CLOSED)throw new ServiceUnavailableError("Persistent lobby admissions are not enabled.");
  const inventory=await inspectLegacyRooms(database);
  if(!inventory.ready)throw new ServiceUnavailableError("Legacy matches still require reconciliation. New lobby admissions are temporarily closed.");
}
