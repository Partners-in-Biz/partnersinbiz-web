import { normalizeHermesEvent } from '@/lib/hermes/progress-events'

describe('normalizeHermesEvent', () => {
  it('preserves assistant delta whitespace exactly', () => {
    const events = normalizeHermesEvent({
      event: 'message.delta',
      run_id: 'run_1',
      delta: ' hello ',
      timestamp: 123,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      event: 'assistant.text_delta',
      runId: 'run_1',
      run_id: 'run_1',
      delta: ' hello ',
      text: ' hello ',
      preview: ' hello ',
    })
  })

  it('preserves whitespace-only assistant deltas', () => {
    const events = normalizeHermesEvent({
      event: 'message.delta',
      delta: ' ',
      timestamp: 123,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      event: 'assistant.text_delta',
      delta: ' ',
      text: ' ',
      preview: ' ',
    })
  })

  it('keeps command input and output fields for inline consoles', () => {
    const events = normalizeHermesEvent({
      event: 'tool.completed',
      tool: 'terminal',
      input: 'npm test',
      stdout: 'PASS',
      stderr: 'warn only',
      exit_code: 0,
      duration_ms: 127,
      timestamp: 123,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      event: 'tool.completed',
      tool: 'terminal',
      input: 'npm test',
      stdout: 'PASS',
      stderr: 'warn only',
      exitCode: 0,
      durationMs: 127,
    })
  })

  it('preserves rich message parts, UI actions, and raw structured payloads', () => {
    const events = normalizeHermesEvent({
      event: 'message.rich',
      run_id: 'run_1',
      timestamp: 123,
      rich_parts: [
        { type: 'markdown', content: '### Launch plan\n- **Approve** final copy' },
        {
          type: 'table',
          caption: 'Channel mix',
          columns: ['Channel', 'Status'],
          rows: [['Email', 'Ready']],
        },
        {
          type: 'gallery',
          images: [
            { url: 'https://cdn.example.com/ad-1.png', alt: 'Ad concept' },
          ],
        },
      ],
      ui_actions: [
        { id: 'copy-summary', type: 'copy', label: 'Copy summary', value: 'Launch plan' },
        { id: 'open-asset', type: 'open', label: 'Open asset', url: 'https://app.example.com/assets/1' },
      ],
      telegram: {
        parse_mode: 'MarkdownV2',
        reply_markup: { inline_keyboard: [[{ text: 'Approve', callback_data: 'approve:run_1' }]] },
      },
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      event: 'message.rich',
      runId: 'run_1',
      richParts: [
        { type: 'markdown', content: '### Launch plan\n- **Approve** final copy' },
        {
          type: 'table',
          caption: 'Channel mix',
          columns: ['Channel', 'Status'],
          // Array rows are normalized to column-keyed records so they can be
          // stored safely in Firestore (no nested arrays).
          rows: [{ Channel: 'Email', Status: 'Ready' }],
        },
        {
          type: 'gallery',
          images: [
            { url: 'https://cdn.example.com/ad-1.png', alt: 'Ad concept' },
          ],
        },
      ],
      uiActions: [
        { id: 'copy-summary', type: 'copy', label: 'Copy summary', value: 'Launch plan' },
        { id: 'open-asset', type: 'open', label: 'Open asset', url: 'https://app.example.com/assets/1' },
      ],
      raw: {
        telegram: {
          parse_mode: 'MarkdownV2',
          reply_markup: { inline_keyboard: [[{ text: 'Approve', callback_data: 'approve:run_1' }]] },
        },
      },
    })
  })

  it('normalizes clarify and model picker events into rich parts and choose actions', () => {
    const clarifyEvents = normalizeHermesEvent({
      event: 'clarify.request',
      run_id: 'run_1',
      action_id: 'clarify-tone',
      question: 'Which tone should I use?',
      choices: ['Direct', 'Warm'],
    })
    const modelEvents = normalizeHermesEvent({
      event: 'model_picker.request',
      run_id: 'run_1',
      action_id: 'model-depth',
      title: 'Choose model depth',
      models: [
        { id: 'fast', label: 'Fast' },
        { id: 'deep', label: 'Deep' },
      ],
    })

    expect(clarifyEvents[0]).toMatchObject({
      event: 'clarify.required',
      richParts: [
        {
          type: 'clarify',
          actionId: 'clarify-tone',
          question: 'Which tone should I use?',
          choices: ['Direct', 'Warm'],
        },
      ],
      uiActions: [
        { id: 'clarify-tone:0', type: 'choose', label: 'Direct', value: 'Direct', actionId: 'clarify-tone' },
        { id: 'clarify-tone:1', type: 'choose', label: 'Warm', value: 'Warm', actionId: 'clarify-tone' },
      ],
    })
    expect(modelEvents[0]).toMatchObject({
      event: 'model_picker.required',
      richParts: [
        {
          type: 'model_picker',
          actionId: 'model-depth',
          title: 'Choose model depth',
          models: [
            { id: 'fast', label: 'Fast' },
            { id: 'deep', label: 'Deep' },
          ],
        },
      ],
      uiActions: [
        { id: 'model-depth:fast', type: 'choose', label: 'Fast', value: 'fast', actionId: 'model-depth' },
        { id: 'model-depth:deep', type: 'choose', label: 'Deep', value: 'deep', actionId: 'model-depth' },
      ],
    })
  })
})
