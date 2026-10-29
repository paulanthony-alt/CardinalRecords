# Cardinal Records

A multiplayer record label simulation. Up to 30 artists per season sell services to each other, sign contracts, build up their cash, and finish the season by uploading their music and following a step-by-step guide to releasing it on streaming services.

## Quick start

```bash
npm install
cp owners.example.json owners.json   # then edit it: your Record Owner accounts
npm start                            # http://localhost:3000
```

Requires **Node.js 22.13+**. It uses Node's built-in SQLite, so the only dependency is Express.

## Roles

| | Record Owner (admin) | Artist (player) |
|---|---|---|
| Account | Defined in `owners.json` / `OWNER_ACCOUNTS` | Username created by a Record Owner |
| PIN | Set in config on first boot, changeable in-app | Chosen by the player on first sign-in |
| Can see PINs | Yes, every player's (Label Console → Roster & PINs) | Only their own |

## How a season works

1. **Pre-season.** An owner creates a season (1 to 365 days, a signing advance, a label cut %, and up to 30 artists), then signs artists by username. Artists sign in, choose a PIN and list their services.
2. **Season live.** The owner starts the clock. Every artist gets the signing advance. Owners can grant or fine money at any time.
3. **Contracts.** Each deal moves through these steps:
   `Buyer offers (cash goes into escrow)` → `Artist signs or counters` → **`Record Owner approves`** → announced in the lobby → `Artist delivers` → `Buyer confirms and rates` → artist is paid, minus the label's cut, which goes into the label vault.
   If an offer is declined, rejected, withdrawn or voided, the buyer gets the escrow back.
4. **Showcase.** The season ends automatically after its last day, or an owner can end it early. Artists upload tracks (MP3/WAV/M4A/AAC/OGG/FLAC, up to 60 MB, 10 per artist). Everyone can listen and like. After uploading, each artist gets the **Release Guide**: 10 steps from mastering to distributors to royalties, with progress saved.
5. **Archive.** The season becomes read-only.

The game side includes XP and levels (Intern → Legend), badges, the Cardinal Chart leaderboard, a live lobby feed and chat, and online indicators.

## Data export

Anyone on a label can download that season's data at any time from **Data & Export**:
- a **ZIP** with `data.json`, CSVs (players, ledger, contracts, contract events, services, feed, tracks) and every uploaded audio file
- a ZIP without the audio, or raw JSON

Owner exports include PINs. Player exports don't.

## Configuration

| Env var | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `DATA_DIR` | `./data` | SQLite database and uploaded audio. **Back this up and keep it on persistent storage.** |
| `OWNER_ACCOUNTS` | none | Overrides `owners.json`. JSON array, or `user:pin:Display Name,user2:pin2` |
| `MAX_UPLOAD_MB` | `60` | |

Owners are created on first boot only. Restarting never resets their PINs. If you configure no owners, a default `owner` / `0000` account is created. Change it.

## Security notes

- PINs are stored in plain text on purpose, because Record Owners need to be able to read them. Tell players not to reuse a PIN they use anywhere else.
- After 5 wrong PINs, an account is locked for 5 minutes. Sessions are HttpOnly, SameSite=Lax cookies.
- An unclaimed account can be claimed by whoever signs in first, so hand usernames out directly. Owners can reset a PIN, which clears it so the player picks a new one.
- Put it behind HTTPS (most hosts do this for you).

## Project layout

```
server.js         Express app and API routes
src/db.js         SQLite schema
src/game.js       Game rules: money, escrow, contract state machine, XP, phases
src/owners.js     Record Owner bootstrap
src/zip.js        Streaming ZIP and CSV export
public/           Single-page client (no build step)
  app.js          UI, routing, audio player
  guide.js        Release Guide content
  styles.css
```
