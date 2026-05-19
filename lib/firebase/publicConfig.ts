import type { FirebaseOptions } from 'firebase/app'

function cleanPublicEnv(value: string | undefined): string {
  return (value ?? '')
    .replace(/\\n/g, '\n')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim()
}

export function getPublicFirebaseConfig(): FirebaseOptions {
  return {
    apiKey: cleanPublicEnv(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
    authDomain: cleanPublicEnv(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
    projectId: cleanPublicEnv(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
    storageBucket: cleanPublicEnv(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: cleanPublicEnv(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
    appId: cleanPublicEnv(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
  }
}

export function getPublicFirebaseVapidKey(): string {
  return cleanPublicEnv(process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY)
}
