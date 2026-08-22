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
