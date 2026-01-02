# Soundstream — Cursor Client Instructions (Read Before Doing Anything)

These are the operational rules for working in this repo.

## Canonical docs (read these first)

- `PROJECT_NOTES.md` (repo root)
- `soundstream/PROJECT_SUMMARY.md`
- `DEPLOYMENT-STATUS.md` (repo root)

If anything disagrees, **stop and ask the user which source is authoritative**.

## Runtime environment rules (critical)

- **No popups / bot-like browser automation**:
  - Do not attempt to complete Tidal logins automatically.
  - Do not click through auth flows rapidly or repeatedly.
- **No localhost services**:
  - Do not start servers on the developer machine for normal use.
  - **Everything runs on `.21`** (`192.168.0.21`) for Soundstream (API on `:3000`, Expo web on `:8081`).
  - Exceptions: **LMS + Roon Core are separate services** and are not to be started on the dev machine as part of Soundstream work.

## LMS safety rule (must follow)

- **Never change settings on the LMS server web interface without asking the user first.**
  - Includes plugin enable/disable, rescans, player/server prefs, transcoding, networking, security, etc.

## Git rule

- After making code changes:
  - `git add` the modified files
  - `git commit` with a descriptive message
  - `git push`


