import { act, render } from '@testing-library/react'

import { DocumentPresence } from '@/components/client-documents/DocumentPresence'

jest.mock('@/lib/firebase/client', () => {
  const realFirestore = { type: 'real-firestore' }
  return {
    db: { type: 'legacy-proxy' },
    getClientDb: jest.fn(() => realFirestore),
    __realFirestore: realFirestore,
  }
})

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(() => ({ type: 'presence-collection' })),
  doc: jest.fn(() => ({ type: 'presence-document' })),
  setDoc: jest.fn(() => Promise.resolve()),
  updateDoc: jest.fn(() => Promise.resolve()),
  deleteDoc: jest.fn(() => Promise.resolve()),
  onSnapshot: jest.fn(() => jest.fn()),
  serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  Timestamp: class Timestamp {},
}))

const firebaseClient = jest.requireMock('@/lib/firebase/client') as {
  db: unknown
  getClientDb: jest.Mock
  __realFirestore: unknown
}
const firestore = jest.requireMock('firebase/firestore') as {
  collection: jest.Mock
}

describe('DocumentPresence Firebase initialization', () => {
  it('resolves the real Firestore singleton before creating a collection reference', async () => {
    let unmount = () => undefined
    await act(async () => {
      const rendered = render(
        <DocumentPresence
          documentId="doc-1"
          currentUserId="user-1"
          currentUserName="Peet"
        />,
      )
      unmount = rendered.unmount
    })

    expect(firebaseClient.getClientDb).toHaveBeenCalledTimes(1)
    expect(firestore.collection).toHaveBeenCalledWith(firebaseClient.__realFirestore, 'document_presence', 'doc-1', 'users')
    expect(firestore.collection).not.toHaveBeenCalledWith(firebaseClient.db, expect.anything(), expect.anything(), expect.anything())

    unmount()
  })
})
