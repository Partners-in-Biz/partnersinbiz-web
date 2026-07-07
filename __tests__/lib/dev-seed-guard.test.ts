import { assertDevSeedAllowed } from '@/lib/dev-seed/guard'

const emulatorEnv = {
  ALLOW_DEV_SEED: '1',
  FIRESTORE_EMULATOR_HOST: 'localhost:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
}

describe('assertDevSeedAllowed', () => {
  it('allows seeding with the explicit flag plus localhost emulators', () => {
    expect(() => assertDevSeedAllowed(emulatorEnv)).not.toThrow()
  })

  it('refuses without the explicit ALLOW_DEV_SEED flag', () => {
    expect(() => assertDevSeedAllowed({ ...emulatorEnv, ALLOW_DEV_SEED: undefined })).toThrow(/ALLOW_DEV_SEED/)
    expect(() => assertDevSeedAllowed({ ...emulatorEnv, ALLOW_DEV_SEED: 'true' })).toThrow(/ALLOW_DEV_SEED/)
  })

  it('refuses when the Firestore emulator host is missing or not localhost', () => {
    expect(() => assertDevSeedAllowed({ ...emulatorEnv, FIRESTORE_EMULATOR_HOST: undefined })).toThrow(/FIRESTORE_EMULATOR_HOST/)
    expect(() => assertDevSeedAllowed({ ...emulatorEnv, FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' })).toThrow(/localhost/)
  })

  it('refuses when the Auth emulator host is missing or not localhost', () => {
    expect(() => assertDevSeedAllowed({ ...emulatorEnv, FIREBASE_AUTH_EMULATOR_HOST: undefined })).toThrow(/FIREBASE_AUTH_EMULATOR_HOST/)
    expect(() => assertDevSeedAllowed({ ...emulatorEnv, FIREBASE_AUTH_EMULATOR_HOST: 'auth.example.com:9099' })).toThrow(/localhost/)
  })

  it('refuses in production-like environments even with emulators configured', () => {
    expect(() => assertDevSeedAllowed({ ...emulatorEnv, NODE_ENV: 'production' })).toThrow(/production/)
    expect(() => assertDevSeedAllowed({ ...emulatorEnv, VERCEL: '1' })).toThrow(/production/)
  })
})
