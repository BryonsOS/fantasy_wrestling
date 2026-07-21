# Fantasy Wrestling League

**Live site:** https://zesty-biscuit-2961d4.netlify.app

A private fantasy pro wrestling site. The commissioner posts the card for upcoming
events (matches + prop bets), members pick winners before bell time, and correct
picks earn points on the league leaderboard.

## How it works

- **Join by invite code** — members sign up with an email, password, display name,
  and the league's invite code. No code, no entry.
- **Event lifecycle** — every event moves through four stages, controlled from the
  admin panel:
  1. **Draft** — hidden from members while the commissioner builds the card
  2. **Picks Open** — members see the card and lock in winners + prop answers
  3. **Locked** — picks freeze at bell time; everyone's picks are revealed
  4. **Final** — results entered; points count toward the standings
- **Scoring** — every match and prop has a point value set by the commissioner
  (main events and longshot props can be worth more).
- **Standings** — total points across all final events, with a per-event breakdown.

## Stack

- **Frontend**: React 18 + TypeScript + Vite, plain CSS (no framework)
- **Backend**: [Supabase](https://supabase.com) — Postgres, auth, and row-level
  security. There is no server code; the browser talks to Supabase directly and
  RLS policies enforce all the rules (pick deadlines, admin-only writes, hiding
  draft events, hiding other people's picks until lock).
- **Hosting**: Netlify (static SPA; `public/_redirects` handles client routing)

## Security model (RLS)

| Table | Members | Admin |
|---|---|---|
| `profiles` | read all, update own display name | read all |
| `league_settings` | no access (signup validates via RPC) | read/update invite code |
| `events` | read non-draft | full control |
| `questions` / `options` | read (non-draft events) | full control |
| `picks` | write own **only while event is open**; see others' once locked | read all |

Signups run through a database trigger that rejects invalid invite codes and
auto-flags the configured admin email as commissioner.

## Development

```bash
npm install
npm run dev
```

Supabase connection is configured in `.env` (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` — these are public client keys; all authorization is
enforced by RLS).

## Commissioner notes

- The invite code lives in **Admin → Invite Code** (initial code: `KAYFABE2026`).
- New events start as drafts. Build the card, then flip to **Picks Open**.
- Flip to **Locked** when the show starts, enter results as matches finish, then
  mark **Final** to score it.
- Results can be entered/corrected at any time from the event's admin page.
