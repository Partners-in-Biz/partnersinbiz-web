import type { FirebaseOptions } from 'firebase/app'
import { cleanFirebaseEnv } from './env'

export function getPublicFirebaseConfig(): FirebaseOptions {
  return {
    apiKey: cleanFirebaseEnv(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
    authDomain: cleanFirebaseEnv(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
    projectId: cleanFirebaseEnv(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
    storageBucket: cleanFirebaseEnv(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: cleanFirebaseEnv(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
    appId: cleanFirebaseEnv(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
  }
}

export function getPublicFirebaseVapidKey(): string {
  return cleanFirebaseEnv(process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY)
}
