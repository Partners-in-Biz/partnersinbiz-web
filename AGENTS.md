# Partners in Biz Web Agent Rules

This repository powers the live Partners in Biz production site.

## Branch Policy

- `main` is production-only.
- `development` is the normal working branch for feature, bugfix, and agent work.
- Do not edit, commit, or push normal work on `main`.
- Do not run `vercel --prod`, promote a Preview deployment, or merge to `main` unless Peet explicitly asks for a production release.

## Required Preflight

Before editing this repo, run:

```bash
git status --short --branch
git pull --ff-only
git status --short --branch
```

After the preflight, the branch must be `development`.

If the repo is on `main`, switch to `development` before editing. If `development` is missing, dirty, diverged, or cannot fast-forward cleanly, stop and report the blocker. Do not force-pull, reset, stash, checkout over work, or overwrite another agent's changes unless Peet explicitly asks for that recovery.

## Deployments

Push normal work to `origin/development`. Vercel should build those pushes as Preview deployments for development/testing. The public production site remains tied to `main`.
