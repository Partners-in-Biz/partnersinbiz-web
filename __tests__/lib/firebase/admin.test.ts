const mockInitializeApp = jest.fn(() => ({ name: 'admin-app' }))
const mockCert = jest.fn((input) => ({ cert: input }))
const mockGetApps = jest.fn(() => [])

jest.mock('firebase-admin/app', () => ({
  initializeApp: mockInitializeApp,
  getApps: mockGetApps,
  cert: mockCert,
}))

jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(),
}))

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(),
}))

describe('Firebase Admin config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    mockInitializeApp.mockClear()
    mockCert.mockClear()
    mockGetApps.mockReturnValue([])
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('normalizes copied env values before initializing storage', async () => {
    process.env.FIREBASE_ADMIN_PROJECT_ID = '"partners-in-biz-85059\\n"'
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL = '"firebase-admin@example.com\\n"'
    process.env.FIREBASE_ADMIN_PRIVATE_KEY = '"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n"'
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = '"partners-in-biz-85059.firebasestorage.app\\n"'

    const { getAdminApp } = await import('@/lib/firebase/admin')
    getAdminApp()

    expect(mockCert).toHaveBeenCalledWith({
      projectId: 'partners-in-biz-85059',
      clientEmail: 'firebase-admin@example.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    })
    expect(mockInitializeApp).toHaveBeenCalledWith(expect.objectContaining({
      storageBucket: 'partners-in-biz-85059.firebasestorage.app',
    }))
  })
})
