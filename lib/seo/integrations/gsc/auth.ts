import { google } from 'googleapis'

export const GSC_SCOPES = ['https://www.googleapis.com/auth/webmasters']

function readEnv(name: string): string | undefined {
  return process.env[name]?.trim()
}

function client() {
  return new google.auth.OAuth2(
    readEnv('GOOGLE_OAUTH_CLIENT_ID'),
    readEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
    readEnv('GSC_REDIRECT_URI'),
  )
}

export function gscAuthUrl(state: string): string {
  return client().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GSC_SCOPES,
    state,
  })
}

export async function exchangeGscCode(code: string) {
  const oauth = client()
  const { tokens } = await oauth.getToken(code)
  return tokens
}

export function refreshGscClient(refreshToken: string) {
  const oauth = client()
  oauth.setCredentials({ refresh_token: refreshToken })
  return oauth
}
