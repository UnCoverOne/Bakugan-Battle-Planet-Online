import { PERSISTENT_LOBBY_ENABLED, LEGACY_LOBBY_CREATION_CLOSED } from "./lobby-cutover";
import { ServiceUnavailableError } from "./server-errors";

export async function assertLobbyAdmissionCutover(database:D1Database) {
  if(!PERSISTENT_LOBBY_ENABLED||!LEGACY_LOBBY_CREATION_CLOSED)throw new ServiceUnavailableError("Persistent lobby admissions are not enabled.");
  const blocker=await database.prepare("SELECT 1 AS blocked FROM lobby_legacy_room_inventory WHERE status<>'completed' LIMIT 1").first();
  if(blocker)throw new ServiceUnavailableError("Legacy matches still require reconciliation. New lobby admissions are temporarily closed.");
}
