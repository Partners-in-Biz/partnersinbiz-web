# Partners in Biz Web Agent Rules

This repository powers the live Partners in Biz production site.

## Branch Policy

- `main` is production-only.
- `development` is the normal working branch for feature, bugfix, and agent work.
- Do not edit, commit, or push normal work on `main`.
- Do not run `vercel --prod`, promote a Preview deployment, or merge to `main` unless Peet explicitly asks for a production release.

## Required Preflight

Before editing this repo, sync first. This is not a blocker gate; it is the routine for preserving any local work and getting onto latest `development`.

```bash
git status --short --branch
# If local changes already exist, checkpoint them before pulling:
git add -A
git commit -m "chore(agent): checkpoint existing local work before sync"
git pull --rebase origin development
git status --short --branch
```

After the sync, the branch must be `development`. If the repo is on `main`, switch to `development` before editing. If `development` is missing, stop and report that hard blocker.

A dirty `development` worktree is expected because multiple agents may work in the same checkout. Dirty or untracked files do not block new work, and "local changes would be overwritten by pull" is not an acceptable reason to stop. Checkpoint-commit existing local work, rebase onto latest `origin/development`, then continue.

Resolve rebase conflicts when they are in files related to the checkpointed work or the task. Only stop for true hard blockers such as missing credentials, a conflict that cannot be resolved safely from the available context, or a broken branch Git cannot rebase. Do not force-pull, reset, stash, checkout over work, or discard another agent's/user's changes unless Peet explicitly asks for that destructive recovery.

## Commit and Push Discipline

Agents must leave completed work committed and pushed to `origin/development`. If tests/builds are relevant, run them before committing. If push is blocked by credentials, network, divergence, or CI/pre-push failures, report the blocker and leave the local commit in place.

## Deployments

Push normal work to `origin/development`. Vercel should build those pushes as Preview deployments for development/testing. The public production site remains tied to `main`.
