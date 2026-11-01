# Cardinal Records

A multiplayer record label simulation. Up to 30 artists per season hire each other for jobs on the class rate sheet, sign contracts, build up their cash, and finish the season by sharing their music and following a step-by-step guide to releasing it on streaming services.

## Quick start

```bash
npm install
neon deploy                          # provisions Postgres on Neon, writes DATABASE_URL to .env.local
cp owners.example.json owners.json   # then edit it: your Record Owner accounts
npm start                            # http://localhost:3000
```

Requires **Node.js 22.13+** and a Postgres database (Lakebase Postgres on Neon, configured in `neon.ts`). The server talks to it with `pg` (node-postgres) through a connection pool and creates its tables on first boot. `npm start` loads `.env` and `.env.local` automatically. Any other Postgres works too: just set `DATABASE_URL`.

## Roles

| | Record Owner (admin) | Artist (player) |
|---|---|---|
| Account | Defined in `owners.json` / `OWNER_ACCOUNTS` | Username created by a Record Owner |
| PIN | Set in config on first boot, changeable in-app | Chosen by the player on first sign-in |
| Can see PINs | Yes, every player's (Admin → Roster & PINs) | Only their own |
| Runs seasons | Every owner can run and change every season, whoever created it | Belongs to one season at a time |

## How a season works

1. **Pre-season.** An owner creates a season (1 to 365 days, the advance, an optional label cut %, and up to 30 artists), then signs artists by username. Artists sign in, choose a PIN and read the rate sheet. Owners can run as many seasons side by side as they like, and move an artist from one season to another.
2. **Season live.** The owner starts the clock. Every artist gets the advance ($1,000 by default, from the rate sheet).
3. **Contracts, priced by the rate sheet.** Players can't set their own prices. To hire someone, a player picks a job from the sheet (Lyricist, Beat Maker, Lead vocals, Mixing engineer, Graphic designer…) and pays by the hour / class block (or per item), or the job's project rate. Each deal moves through these steps:
   `Buyer offers (cash goes into escrow)` → `Artist signs` → **`Record Owner approves`** (every service is approved by a teacher before the work is done) → announced in the lobby → `Artist delivers` → `Buyer confirms and rates` → artist is paid.
   If an offer is declined, rejected, withdrawn or voided, the buyer gets the escrow back. Owners can also charge the artist the sheet's **late fee** ($50; the client isn't charged) or mark the work **not done** ($100 fine to the artist, and the client is refunded).
4. **The rate sheet's money.** The **Game Bonus** ($40 for every two different people an artist hires) is paid automatically. In **Admin → Treasury & fines**, owners charge any fee or fine on the sheet (project fee, mixing/mastering time per song, late deliverables per item, studio no-show, general fine with a $25 minimum, bank processing, tardy, unexcused absence, cheating as 50 to 100% of the account) and pay income items (volunteering per class block, Studio Assistant from $15). Fines can take a balance below $0. They aren't announced in the lobby, and each artist sees their own under Data. Owners can change any amount for a season in **Admin → Rate sheet**. Deals already made keep their price.
5. **Showcase.** The season ends automatically after its last day, or an owner can end it early. **Music sharing stays closed until a Record Owner opens it** (Admin → Season settings, or the button on the Showcase page). Owners can open it early during the season, close it again at any time, and archiving a season closes it. While it's open, artists share a link to each track on Spotify, SoundCloud, YouTube, Apple Music, Bandcamp or any other public page (up to 10 per artist). Everyone can open the link to listen and can like tracks. The app stores only the link, never audio. After sharing, each artist gets the **Release Guide**: 10 steps from mastering to distributors to royalties, with progress saved.
6. **Archive.** The season becomes read-only.

**Admin menu.** Record Owners get an **Admin** pull-down in the menu bar with every owner tool: Review queue, Roster & PINs, Treasury & fines, Rate sheet, Season settings, All seasons and New season. Players never see it.

The game side includes XP and levels (Intern → Legend), badges, the Cardinal Chart leaderboard, a live lobby feed and chat, and online indicators.

**Look:** a 1996 label-office desktop. Every panel is a window with a cardinal-red title bar on a maroon desktop, with a menu bar on top and a taskbar at the bottom (cash, day, level, clock, and a red button for your next move). Fonts are Libre Franklin and Courier Prime.

## Data export

Anyone on a label can download that season's data at any time from **Data & Export**:
- a **ZIP** with `data.json` (including the season's rate sheet) and CSVs (players, ledger, contracts with their job and pricing, contract events, feed, tracks with their links)
- or raw JSON

Owner exports include PINs. Player exports don't.

## Configuration

| Env var | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `DATABASE_URL` | none (required) | Postgres connection string. Use Neon's pooled (`-pooler`) URL; `neon deploy` / `neon env pull` write it for you. |
| `DATABASE_URL_UNPOOLED` | none | Neon's direct connection string. When set, the schema is created over it on boot. |
| `PG_POOL_MAX` | `10` | Max connections in the server's pool. |
| `OWNER_ACCOUNTS` | none | Overrides `owners.json`. JSON array, or `user:pin:Display Name,user2:pin2` |

Owners are created on first boot only. Restarting never resets their PINs. If you configure no owners, a default `owner` / `0000` account is created. Change it.

## Deploy on Render

`render.yaml` is a Render Blueprint for a free web service: `npm install`, `npm start`, Node 22, health check at `/healthz`. In Render, choose **New → Blueprint**, pick this repo, and fill in the three secret values when asked:

- `DATABASE_URL`: Neon pooled connection string (the host contains `-pooler`)
- `DATABASE_URL_UNPOOLED`: Neon direct connection string
- `OWNER_ACCOUNTS`: Record Owner accounts, e.g. `boss:4821:The Boss,coowner:7350:Co-Owner`

On the free plan the service spins down after 15 minutes without traffic and takes about a minute to wake up. Its local disk is wiped whenever it spins down, restarts or redeploys, which doesn't matter here: everything, including Showcase tracks (stored as links), lives in Neon.

`sync: false` values are only asked for when the Blueprint is first created. To change one later, edit it on the service's **Environment** page.

## Security notes

- PINs are stored in plain text on purpose, because Record Owners need to be able to read them. Tell players not to reuse a PIN they use anywhere else.
- After 5 wrong PINs, an account is locked for 5 minutes. Sessions are HttpOnly, SameSite=Lax cookies.
- An unclaimed account can be claimed by whoever signs in first, so hand usernames out directly. Owners can reset a PIN, which clears it so the player picks a new one.
- Put it behind HTTPS (most hosts do this for you).

## Project layout

```
server.js         Express app and API routes
src/db.js         Postgres pool, schema and transaction helper
src/game.js       Game rules: money, escrow, contract state machine, XP, phases
src/owners.js     Record Owner bootstrap
src/zip.js        Streaming ZIP and CSV export
public/           Single-page client (no build step)
  app.js          UI and routing
  guide.js        Release Guide content
  styles.css
```
