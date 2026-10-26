/** A 100-bit recovery secret, grouped for easier transcription. */
export function generateRecoveryCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const characters = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
  return Array.from({ length: 5 }, (_, index) => characters.slice(index * 4, index * 4 + 4).join("")).join("-");
}
