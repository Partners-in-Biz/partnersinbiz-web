export const CONVERSATION_MESSAGE_SUBMIT_TIMEOUT_MS = 45_000

const SUBMIT_TIMEOUT_MESSAGE =
  'Message submission timed out before an agent run was confirmed. Your draft has been restored.'

export async function postConversationMessage(
  url: string,
  init: RequestInit,
  timeoutMs = CONVERSATION_MESSAGE_SUBMIT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort()
          reject(new Error(SUBMIT_TIMEOUT_MESSAGE))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}
