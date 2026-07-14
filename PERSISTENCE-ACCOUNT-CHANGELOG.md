# Persistence and account upgrade

## Browser persistence

The app now saves all durable client state in browser storage, including the current route, selected deck, deck-builder draft, filters, settings, history, replay position, active match, match mode, and player identifier. Refreshing or restarting the browser restores the previous state.

## Logged-out users

The entry screen offers **Local Profile** mode. No account is required, and data remains on that browser until the user explicitly deletes local browser data. Signing out of a cloud account keeps the current local copy.

## Accounts and sync

New `/api/auth` and `/api/user-data` routes provide:

- Sign up and login
- Secure session-cookie restoration
- Profile updates
- Password changes with all other sessions revoked
- Account deletion
- Automatic cross-device synchronization
- Optimistic concurrency with deck/history merging on conflicts

## Security

Passwords use PBKDF2-SHA-256 with per-account random salts and 210,000 iterations. Session tokens are random, sent only in HTTP-only cookies, and stored in D1 only as SHA-256 hashes.
