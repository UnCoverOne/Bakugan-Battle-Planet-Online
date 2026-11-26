# Persistent lobby cutover

Play opens and joins lobbies through the persistent session API. The account or
guest-browser identity owns the membership through preparation, gameplay, and
the result. Navigation leaves the membership in place. Explicit departure or
one hour without a heartbeat ends it. Training uses automatic AI deck
selection and a private checkpoint. Online controller claims require a current
membership. Lobby chat also serves the gameplay view.

Apply the D1 migrations before deploying the branch. Legacy active rooms and
browser-only Training sessions do not carry over. Archived records and replay
decoders remain available. The read-only command
`npm run inspect:lobby-cutover -- --remote` reports legacy room counts.
Those rows no longer block new lobby admissions.

Run `npm run audit:lobby` to check retired entry points, modules, and assets.
The audit also lists artwork with no literal references. Dynamic artwork can be
in use without a literal filename.
