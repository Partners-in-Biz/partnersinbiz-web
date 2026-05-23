# Vercel Preview environment parity

`development` is the normal testing branch for `partnersinbiz-web`. Before merging or promoting to `main`, the branch-scoped Vercel Preview must have the same environment variable names as Production so server-only paths can be tested before release.

## Current target

- Project: `partnersinbiz-web`
- Team scope: `team_LuA8419f7IWgTx7sWAO3KxZQ`
- Preview branch: `development`
- Production branch: `main`

## Audit command

Run from the repo root. The temporary files contain secret values, so keep them under `.codex-tmp/` and delete them after the audit.

```bash
mkdir -p .codex-tmp/env-audit
npx vercel env pull .codex-tmp/env-audit/production.env \
  --environment=production \
  --scope team_LuA8419f7IWgTx7sWAO3KxZQ \
  --yes
npx vercel env pull .codex-tmp/env-audit/preview-development.env \
  --environment=preview \
  --git-branch=development \
  --scope team_LuA8419f7IWgTx7sWAO3KxZQ \
  --yes
node - <<'NODE'
const fs = require('fs')
const dotenv = require('dotenv')
function keys(path) {
  return new Set(Object.keys(dotenv.parse(fs.readFileSync(path))))
}
const prod = keys('.codex-tmp/env-audit/production.env')
const preview = keys('.codex-tmp/env-audit/preview-development.env')
const missing = [...prod].filter((key) => !preview.has(key)).sort()
console.log(JSON.stringify({
  productionCount: prod.size,
  previewDevelopmentCount: preview.size,
  missingFromPreviewDevelopment: missing,
}, null, 2))
NODE
rm -rf .codex-tmp/env-audit
```

Expected healthy output: `missingFromPreviewDevelopment: []`.

## 2026-05-21 parity repair

The `development` Preview was missing `SOCIAL_TOKEN_MASTER_KEY`, which broke Hermes message dispatch because agent API keys could not be decrypted. A follow-up parity audit found and filled the remaining Production-name gaps for `Preview (development)`:

- `AI_API_KEY`
- `CRON_SECRET`
- `GSC_REDIRECT_URI`
- `LINKEDIN_PERSONAL_CLIENT_ID`
- `LINKEDIN_PERSONAL_CLIENT_SECRET`
- `TWITTER_CLIENT_ID`
- `TWITTER_CLIENT_SECRET`

`CRON_SECRET` is Preview-specific because the Production value pulled as empty through the CLI. That is acceptable for Preview route validation; do not copy Preview secrets back to Production.
