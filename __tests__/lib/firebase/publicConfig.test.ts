import { getPublicFirebaseConfig, getPublicFirebaseVapidKey } from '@/lib/firebase/publicConfig'

describe('public Firebase config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('normalizes values copied with escaped newlines before Firebase Installations sees them', () => {
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = '"AIza-example\\n"'
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = '"partners-in-biz-85059.firebaseapp.com\\n"'
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = '"partners-in-biz-85059\\n"'
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = '"partners-in-biz-85059.firebasestorage.app\\n"'
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = '"430887310034\\n"'
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID = '"1:430887310034:web:1307b4000ec75dbe47d30b\\n"'
    process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY = '"vapid-key\\n"'

    expect(getPublicFirebaseConfig()).toEqual({
      apiKey: 'AIza-example',
      authDomain: 'partners-in-biz-85059.firebaseapp.com',
      projectId: 'partners-in-biz-85059',
      storageBucket: 'partners-in-biz-85059.firebasestorage.app',
      messagingSenderId: '430887310034',
      appId: '1:430887310034:web:1307b4000ec75dbe47d30b',
    })
    expect(getPublicFirebaseVapidKey()).toBe('vapid-key')
  })
})
