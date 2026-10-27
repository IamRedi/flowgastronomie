# Local release tooling

Run `npm run release:verify` with the documented local `.env` and PostgreSQL.
On Windows, npm/npx JavaScript entry points run through Node without a shell;
Linux and macOS retain native npm/npx commands. Gate output remains inherited.

`npm run test:e2e -- <Playwright arguments>` builds the web app with the isolated
API URL `http://localhost:4100` before Playwright starts its owned servers on
ports 3300 and 4100. Build time is separate from the server-start deadline.
Only the four complete multilingual journeys have a 60-second test budget;
all other tests retain Playwright's default. Reservation fixtures use unique
identities so repeated runs do not select earlier reservations.

The backup/restore target defaults to port 55432 locally and 15432 in CI, where
55432 can already be occupied on the runner. If another local project owns
that port, set `RESTORE_POSTGRES_PORT=55433` (or another verified free port) in
the local `.env`. Both Compose and the rehearsal use this value. The source
database is unchanged; CI needs no override.
