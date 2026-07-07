// lib/dev-seed/guard.ts
// Safety gate for dev seed scripts. Seeding is ONLY allowed against local
// Firebase emulators, and only with an explicit opt-in flag. This can never
// pass against production: firebase-admin routes all traffic to the emulator
// hosts when these env vars are set, and non-localhost hosts are rejected.

export type DevSeedEnv = Partial<Record<string, string>>

const LOCALHOST_PATTERN = /^(localhost|127\.0\.0\.1|\[::1\]):\d+$/

function requireLocalhost(env: DevSeedEnv, key: string): void {
  const value = (env[key] ?? '').trim()
  if (!value) {
    throw new Error(`Refusing to seed: ${key} is not set. Start the Firebase emulators and export ${key} (e.g. localhost:8080).`)
  }
  if (!LOCALHOST_PATTERN.test(value)) {
    throw new Error(`Refusing to seed: ${key}='${value}' is not a localhost emulator address.`)
  }
}

export function assertDevSeedAllowed(env: DevSeedEnv = process.env as DevSeedEnv): void {
  if (env.ALLOW_DEV_SEED !== '1') {
    throw new Error("Refusing to seed: set ALLOW_DEV_SEED=1 explicitly to confirm you are seeding a local emulator.")
  }
  if (env.NODE_ENV === 'production' || env.VERCEL) {
    throw new Error('Refusing to seed: this looks like a production environment (NODE_ENV/VERCEL set).')
  }
  requireLocalhost(env, 'FIRESTORE_EMULATOR_HOST')
  requireLocalhost(env, 'FIREBASE_AUTH_EMULATOR_HOST')
}
