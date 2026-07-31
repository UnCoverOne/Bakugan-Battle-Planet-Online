export async function readJsonResponse(response: Response, fallbackMessage: string) {
  const body = await response.text();
  if (!body.trim()) {
    throw new Error(`${fallbackMessage} (HTTP ${response.status}).`);
  }
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new Error(`${fallbackMessage} (HTTP ${response.status}).`);
  }
}
