#!/usr/bin/env node

const required = [
  'RESEND_API_KEY',
  'RESEND_WEBHOOK_SECRET',
  'CRON_SECRET',
  'UNSUBSCRIBE_TOKEN_SECRET',
  'NEXT_PUBLIC_APP_URL',
]

const optional = [
  'EMAIL_PROVIDER',
  'RESEND_WEBHOOK_REQUIRE_SIGNATURE',
]

const missing = required.filter((key) => !process.env[key])
const presentOptional = optional.filter((key) => process.env[key])

console.log('Email deliverability/security v3 environment check')
console.log(`Required present: ${required.length - missing.length}/${required.length}`)

if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(', ')}`)
  console.error('Set missing values in Vercel or the target runtime before production rollout. Do not paste secrets into task comments.')
  process.exitCode = 1
} else {
  console.log('All required env vars are present.')
}

if (presentOptional.length > 0) {
  console.log(`Optional hardening/config present: ${presentOptional.join(', ')}`)
} else {
  console.log('Optional hardening/config present: none')
}
