import type { Core } from "./game";

export function createCoreAdditionGuard(
  coreIds: readonly string[],
  requiredTypes: readonly string[],
  hasCharacters: boolean,
  singleton: boolean,
  catalogue: readonly Pick<Core, "id" | "type">[],
) {
  const cores = new Map(catalogue.map(core => [core.id, core]));
  const requiredCounts = new Map<string, number>();
  const selectedTypes = new Map<string, number>();
  const selectedIds = new Map<string, number>();
  for (const type of requiredTypes) requiredCounts.set(type, (requiredCounts.get(type) ?? 0) + 1);
  for (const id of coreIds) {
    selectedIds.set(id, (selectedIds.get(id) ?? 0) + 1);
    const type = cores.get(id)?.type;
    if (type) selectedTypes.set(type, (selectedTypes.get(type) ?? 0) + 1);
  }
  return (id: string) => {
    const core = cores.get(id);
    if (!core || coreIds.length >= 6 || (singleton && (selectedIds.get(id) ?? 0) >= 1)) return false;
    return !hasCharacters || (selectedTypes.get(core.type) ?? 0) < (requiredCounts.get(core.type) ?? 0);
  };
}
