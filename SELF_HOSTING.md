# Self-hosting guide

This guide deploys the complete application, including multiplayer API and persistent match rooms. The recommended free-tier architecture is:

```text
GitHub repository
        |
        v
Cloudflare Workers Builds or GitHub Actions
        |
        +--> Cloudflare Worker + static assets
        |
        +--> Cloudflare D1 (matches, accounts, sessions, synced user data)
```

## 1. What you need

- A free GitHub account.
- A free Cloudflare account.
- Git.
- Node.js 22.13.0 or newer and npm.
- On Windows, WSL 2 is recommended because the verified build scripts use Bash, `flock`, and GNU `timeout`.

The archive intentionally excludes `node_modules`, `dist`, `.wrangler`, `.sites-runtime`, Git history, and credentials. They are generated locally.

## 2. Run it locally first

Unzip the package, open a terminal in the project folder, and run:

```bash
npm ci
npm run dev
```

Open the URL shown in the terminal. Create a profile, open Training play, and verify that the deck builder and card compendium load. Local multiplayer can be tested with two browser profiles/windows using the same local URL and a room code.

Stop the development server with `Ctrl+C`.

## 3. Create the Cloudflare D1 database

Authenticate Wrangler:

```bash
npx wrangler login
npx wrangler whoami
```

Create the database:

```bash
npx wrangler d1 create bakugan-battle-planet-online
```

Wrangler prints a `database_id`. Open `wrangler.jsonc` and replace:

```json
"database_id": "00000000-0000-0000-0000-000000000000"
```

with the ID Wrangler returned. Keep the binding name exactly `DB`; the server API reads `env.DB`.

Initialize the remote schema:

```bash
npx wrangler d1 execute bakugan-battle-planet-online --remote --file=./drizzle/0000_sad_silver_centurion.sql --config wrangler.jsonc
npx wrangler d1 execute bakugan-battle-planet-online --remote --file=./drizzle/0001_accounts_and_sync.sql --config wrangler.jsonc
```

The APIs also create the tables defensively on first use, but applying both migrations makes deployment state explicit.

## 4. Build and validate

```bash
npm run lint
npm test
npm run cf:dry-run
```

`npm test` builds the Vinext Worker and checks the rendered application metadata. `cf:dry-run` validates the deployable Worker and static-asset upload without publishing it.

## 5. First manual Cloudflare deployment

```bash
npm run cf:deploy
```

Wrangler builds and deploys the site, then prints a `*.workers.dev` URL. Open it in two different browser profiles and test this path:

1. Set a display name on each profile.
2. Build or select a legal deck.
3. On browser A, create a room in Online Match.
4. On browser B, join with the room code.
5. Ready both players, place the twelve BakuCores, and advance through energize, selection, secret targeting, roll, brawl, damage, end, and result states.
6. Refresh one browser during the match and confirm it reconnects within 30 seconds.
7. Create an account, edit a deck or setting, then log in from a second browser profile and confirm that the data appears there.
8. Sign out and confirm that the browser copy remains available through **Local Profile** mode.

## 6. Put the project on GitHub

Create an empty repository on GitHub. Do not initialize it with another README or license. Then, from the project folder:

```bash
git init
git add .
git commit -m "Initial self-hostable Bakugan TCG client"
git branch -M main
git remote add origin https://github.com/YOUR-USER/YOUR-REPOSITORY.git
git push -u origin main
```

The D1 database ID is an infrastructure identifier, not a password, so it can remain in `wrangler.jsonc`. Never commit Cloudflare API tokens, `.dev.vars`, `.env` files, or account credentials.

## 7A. Recommended continuous deployment: Cloudflare Workers Builds

Cloudflare Workers Builds connects directly to GitHub and deploys every push without storing a Cloudflare API token in GitHub.

1. In Cloudflare, open **Workers & Pages**.
2. Choose **Create application** and the option to import/connect a Git repository for a Worker.
3. Authorize GitHub and select the repository.
4. Use `main` as the production branch.
5. Set the build command to:

   ```bash
   npm ci && npm run build
   ```

6. Set the deploy command to:

   ```bash
   npx wrangler deploy --config wrangler.jsonc
   ```

7. Leave the root directory as `/` unless the repository is a monorepo.
8. Save and deploy.

Because the D1 binding is declared in `wrangler.jsonc`, future builds use the same database. Check the first build log and then test the deployed room flow with two browsers.

## 7B. Alternative continuous deployment: GitHub Actions

An optional workflow is included at `deploy/github-actions-cloudflare.yml`.

1. In Cloudflare, create an API token with permission to deploy Workers and use the D1 resource for this account.
2. Copy your Cloudflare Account ID from the Cloudflare dashboard.
3. In GitHub, open **Settings > Secrets and variables > Actions** and add:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
4. Copy the workflow into GitHub's workflow directory:

   ```bash
   mkdir -p .github/workflows
   cp deploy/github-actions-cloudflare.yml .github/workflows/deploy-cloudflare.yml
   git add .github/workflows/deploy-cloudflare.yml
   git commit -m "Enable Cloudflare deployment"
   git push
   ```

5. Watch the run under the repository's **Actions** tab.

Use either Workers Builds or GitHub Actions, not both, unless duplicate deployments are intentional.

## 8. Add a custom domain

After the Worker deploys:

1. Open **Workers & Pages** in Cloudflare.
2. Select `bakugan-battle-planet-online`.
3. Open **Settings > Domains & Routes**.
4. Add a custom domain or a route on a domain already managed by Cloudflare.
5. Wait for TLS/DNS activation, then test `/api/game` by creating a room through the UI.

## 9. Why this package uses Workers instead of static Pages

The interface is not only HTML/CSS/JavaScript. `/api/game` enforces legal actions and match state; `/api/auth` manages accounts and secure sessions; and `/api/user-data` synchronizes versioned user snapshots. Static Cloudflare Pages and GitHub Pages cannot run those APIs.

Cloudflare shows Workers and Pages in the same dashboard area. For this codebase, deploy it as a Worker with static assets and D1. Converting it to a Pages project would require repackaging the Vinext Worker as Pages advanced-mode Functions and recreating its bindings; it provides no practical free-tier advantage for this build.

GitHub Pages can only be used for a separate static marketing/manual site. It cannot host the playable client as supplied.

## 10. Back up and inspect match data

List databases:

```bash
npx wrangler d1 list
```

Inspect recent rooms:

```bash
npx wrangler d1 execute bakugan-battle-planet-online --remote --command="SELECT code, updated_at FROM matches ORDER BY updated_at DESC LIMIT 20" --config wrangler.jsonc
```

Export the production database before destructive schema changes:

```bash
npx wrangler d1 export bakugan-battle-planet-online --remote --output=backup.sql --config wrangler.jsonc
```

`backup.sql` may contain player-selected names, email addresses, password hashes and salts, hashed session tokens, deck data, settings, and match history. Store it privately, restrict access, and do not commit it.

## 11. Updating the site

For each update:

```bash
npm ci
npm run lint
npm test
git add .
git commit -m "Describe the update"
git push
```

Workers Builds or GitHub Actions will deploy the pushed commit. For a manual deployment, run `npm run cf:deploy` after testing.

## 12. Troubleshooting

### `The match database is unavailable`

The Worker does not have a D1 binding named `DB`. Confirm the `d1_databases` entry in `wrangler.jsonc`, the real database ID, and that the deployment used `--config wrangler.jsonc`.

### The page loads but room creation fails

Open browser developer tools, inspect the `/api/game` response, and check Worker logs:

```bash
npx wrangler tail bakugan-battle-planet-online
```

### Build scripts fail on Windows

Use WSL 2 or a Linux CI runner. The verified scripts require Bash, `flock`, and GNU `timeout`.

### D1 migration says the table already exists

The migration uses `CREATE TABLE`, while the API also creates the table if missing. If the correct `matches` table already exists, do not rerun the initial migration. Inspect it first instead of deleting production data.

### A Cloudflare deployment exceeds a free-tier limit

Review Cloudflare's current Workers and D1 usage dashboards. Limits and pricing change; do not assume historical quotas. Reduce logs, test traffic, or stored old match rows before considering a paid plan.

## 13. Security and production checklist

- Keep Cloudflare and GitHub accounts protected with MFA.
- Never commit API tokens, backups, `.env*`, or `.dev.vars`.
- Keep the Worker API and the UI on the same origin.
- Review the commercial-asset permission before making the repository public.
- Add moderation/privacy terms before collecting public user accounts or chat.
- Add rate limiting, account authentication, abuse controls, and an administrator workflow before advertising an unrestricted public service.
- Periodically remove abandoned match rows according to a published retention policy.
- Treat the current local profile UI as client-side identity, not secure authentication.

## Official references

- Cloudflare Vite plugin: https://developers.cloudflare.com/workers/vite-plugin/
- Cloudflare Next.js on Workers: https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/
- Cloudflare D1 getting started: https://developers.cloudflare.com/d1/get-started/
- Cloudflare Workers Builds: https://developers.cloudflare.com/workers/ci-cd/builds/
- Cloudflare GitHub Actions: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- GitHub repository creation: https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository

### Accounts work locally but not after deployment

Confirm that `0001_accounts_and_sync.sql` was applied and that the deployed Worker has the `DB` binding. Account routes are `/api/auth` and `/api/user-data`; both require the Worker runtime and cannot operate on a static-only host.

### Cloud sync reports a conflict

This usually means another device saved first. The client automatically merges unique decks and match-history records, keeps the newer general state, and retries. Leave the page open briefly or use **Settings > Sync now**.

### Security notes

Production traffic should remain on HTTPS. Cloudflare Workers provides HTTPS on `workers.dev` and custom domains. Session cookies become `Secure` automatically on HTTPS. Rotate or remove old D1 backups according to your privacy policy.
