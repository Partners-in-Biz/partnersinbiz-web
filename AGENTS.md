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

After the preflight, the branch must be `development`. If the repo is on `main`, switch to `development` before editing. If `development` is missing, diverged, or cannot fast-forward cleanly, stop and report the blocker.

A dirty `development` worktree is expected because multiple agents may work in the same checkout. Dirty or untracked files do not block new work. Before editing, inspect the status, identify which files are yours, and avoid overwriting unrelated changes. Stage only the files changed for your task unless Peet explicitly asks for a broader cleanup.

Do not force-pull, reset, stash, checkout over work, or overwrite another agent's/user's changes unless Peet explicitly asks for that recovery.

## Commit and Push Discipline

Agents must leave completed work committed and pushed to `origin/development`. Use focused commits that include only your task's files. If tests/builds are relevant, run them before committing. If push is blocked by credentials, network, divergence, or CI/pre-push failures, report the blocker and leave the local commit in place.

## Deployments

Push normal work to `origin/development`. Vercel should build those pushes as Preview deployments for development/testing. The public production site remains tied to `main`.
