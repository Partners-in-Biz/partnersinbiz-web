export function cleanFirebaseEnv(value: string | undefined): string {
  return (value ?? '')
    .replace(/\\n/g, '\n')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim()
}
