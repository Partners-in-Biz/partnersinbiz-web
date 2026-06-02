#!/usr/bin/env node

const env = process.env.VERCEL_ENV || "";
const targetEnv = process.env.VERCEL_TARGET_ENV || "";
const branch = process.env.VERCEL_GIT_COMMIT_REF || "";
const message = process.env.VERCEL_GIT_COMMIT_MESSAGE || "";

const productionBranches = new Set(["main", "master"]);
const explicitPreviewBuild = /\[(vercel-build|preview-build)\]/i.test(message);

const shouldBuild =
  env === "production" ||
  targetEnv === "production" ||
  productionBranches.has(branch) ||
  explicitPreviewBuild;

if (!env && !targetEnv && !branch) {
  console.log("Vercel build guard: missing Vercel environment metadata; building by default.");
  process.exit(1);
}

if (shouldBuild) {
  console.log(
    `Vercel build guard: building for env=${env || "unknown"} target=${targetEnv || "unknown"} branch=${branch || "unknown"}.`,
  );
  process.exit(1);
}

console.log(
  `Vercel build guard: skipping preview build for branch=${branch || "unknown"}. Add [vercel-build] to the commit message to force a preview build.`,
);
process.exit(0);
