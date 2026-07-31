# Persistence and account upgrade

## Browser persistence

The app now saves all durable client state in browser storage, including the current route, selected deck, deck-builder draft, filters, settings, history, replay position, active match, match mode, and player identifier. Refreshing or restarting the browser restores the previous state.

## Logged-out users

No account is required, and guest data remains in browser storage until the user explicitly deletes it. While an account is active, that guest snapshot is left unchanged and is restored on logout.

## Accounts and sync

New `/api/auth` and `/api/user-data` routes provide:

- Sign up and login
- Secure session-cookie restoration
- Profile updates
- Password changes with all other sessions revoked
- Account deletion
- A single atomic guest-data import choice during registration
- Existing-account login that loads account data only
- Guest browser storage isolated from all signed-in writes
- Automatic cross-device synchronization with logout flushing
- Optimistic concurrency with account-revision conflict handling

## Security

Passwords use PBKDF2-SHA-256 with per-account random salts and 210,000 iterations. Session tokens are random, sent only in HTTP-only cookies, and stored in D1 only as SHA-256 hashes.
