import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
import { auth, db, waitForPersistence } from './config'

async function createSessionCookie(idToken: string) {
  const response = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const error = new Error(body?.error ?? 'Could not create login session') as Error & { code?: string }
    error.code = 'app/session-cookie-failed'
    throw error
  }
}

export async function loginWithEmail(email: string, password: string) {
  await waitForPersistence()
  const credential = await signInWithEmailAndPassword(auth, email, password)
  const idToken = await credential.user.getIdToken()
  await createSessionCookie(idToken)
  return credential.user
}

export async function registerWithEmail(email: string, password: string, name: string) {
  await waitForPersistence()
  const credential = await createUserWithEmailAndPassword(auth, email, password)
  // Use merge:true and omit role — the server-side session endpoint owns role assignment
  await setDoc(doc(db, 'users', credential.user.uid), {
    name,
    email,
    createdAt: new Date(),
  }, { merge: true })
  const idToken = await credential.user.getIdToken()
  await createSessionCookie(idToken)
  return credential.user
}

export async function logout() {
  await signOut(auth)
  await fetch('/api/auth/session', { method: 'DELETE' })
}

export async function resetPassword(email: string) {
  await sendPasswordResetEmail(auth, email)
}
