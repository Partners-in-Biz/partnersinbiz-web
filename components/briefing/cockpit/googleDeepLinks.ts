export function gmailThreadUrl(threadId?: string | null): string {
  if (!threadId) return 'https://mail.google.com/mail/u/0/#inbox'
  return `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(threadId)}`
}

export function driveFileUrl(file: { webViewLink?: string | null; id?: string }): string {
  if (file.webViewLink) return file.webViewLink
  return file.id ? `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view` : 'https://drive.google.com/drive/recent'
}
