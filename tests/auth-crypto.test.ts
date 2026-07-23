import test from "node:test";
import assert from "node:assert/strict";
import {
  PASSWORD_ITERATIONS,
  createPasswordRecord,
  normalizeEmail,
  passwordRecordNeedsUpgrade,
  validateAccountInput,
  verifyPassword,
} from "../lib/account-server";

test("account passwords are salted and verified without storing plaintext", async () => {
  const password = "Bakugan-Brawl-2026";
  const first = await createPasswordRecord(password);
  const second = await createPasswordRecord(password);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(await verifyPassword(password, { password_hash: first.hash, password_salt: first.salt, password_iterations: first.iterations }), true);
  assert.equal(await verifyPassword("wrong-password", { password_hash: first.hash, password_salt: first.salt, password_iterations: first.iterations }), false);
  assert.equal(first.hash.includes(password), false);
});

test("password hashing stays within the Cloudflare Workers PBKDF2 limit", async () => {
  const record = await createPasswordRecord("Bakugan-Brawl-2026");
  assert.equal(PASSWORD_ITERATIONS, 100_000);
  assert.equal(record.iterations, PASSWORD_ITERATIONS);
  assert.equal(passwordRecordNeedsUpgrade(75_000), true);
  assert.equal(passwordRecordNeedsUpgrade(PASSWORD_ITERATIONS), false);
  await assert.rejects(
    () => verifyPassword("Bakugan-Brawl-2026", {
      password_hash: record.hash,
      password_salt: record.salt,
      password_iterations: PASSWORD_ITERATIONS + 1,
    }),
    /PBKDF2 supports at most 100000 iterations/,
  );
});

test("account input normalizes email and enforces password length", () => {
  assert.equal(normalizeEmail("  BRAWLER@Example.COM "), "brawler@example.com");
  assert.equal(validateAccountInput("BRAWLER@Example.COM", "1234567890", "Dan"), "brawler@example.com");
  assert.throws(() => validateAccountInput("not-an-email", "1234567890", "Dan"));
  assert.throws(() => validateAccountInput("a@example.com", "short", "Dan"));
});
