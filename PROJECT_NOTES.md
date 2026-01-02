# Soundstream — Project Notes (Read This First)

This is the **single canonical “project notes” entrypoint** for Soundstream. Any agent (human or AI) should read this file before doing any work.

## Required reading (in order)

1. `PROJECT_SUMMARY.md`
   - High-level architecture, key features, server endpoints, and important implementation notes.

2. `../DEPLOYMENT-STATUS.md`
   - Current status of the `.21` host deployment (ports, services, known issues, how to check logs).

3. `DEPLOYMENT_NOTES.md`
   - Additional deployment details and historical context.

4. `DEVELOPMENT_GUIDELINES.md` and `CODE_REVIEW_PROCESS.md`
   - How we want changes made, reviewed, and tested.

5. `../DEPLOYMENT-STATUS.md`
   - Treat `.21` as the runtime host. Nothing should be started on localhost (except LMS + Roon Core, which live elsewhere).

## Where things live

- **App (Expo / React Native)**: `client/`
- **API + proxy + relay server (Express)**: `server/` (entrypoint: `server/index.ts`)
- **Chromecast receiver projects**: `../lms-cast/` and `../roon-cast/`

## If you’re about to change server behavior

- Confirm whether the target environment is **the `.21` host** deployment or local development.
- Prefer minimal, isolated changes (see `CHANGE_MANAGEMENT.md`).


