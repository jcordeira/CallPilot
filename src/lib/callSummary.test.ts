import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import fubWebhook from '../../netlify/functions/fub-webhook'
import {
  extractTranscript,
  formatCallStamp,
  formatDuration,
  formatSummaryNote,
  handleFubCallSummaryWebhook,
  noteMentionsCall,
  parseSummarySections,
  runCallSummarySweep,
  summarizeLoadedCall,
  type CallSummaryDeps,
} from '../../netlify/functions/_shared/callSummary'
import { resetCallSummaryStoreForTests } from '../../netlify/functions/_shared/callSummaryStore'

const { getStoreMock } = vi.hoisted(() => ({
  getStoreMock: vi.fn((_input?: unknown): unknown => {
    throw new Error('The environment has not been configured to use Netlify Blobs')
  }),
}))

vi.mock('@netlify/blobs', () => ({
  getStore: (input: unknown) => getStoreMock(input),
}))

const transcript = [
  'Agent: This is Frankie with Cliffco Mortgage, calling about your purchase pre-approval.',
  'Borrower: I am Ada. I make about ninety thousand a year at the hospital and I have been there six years.',
  'Agent: What price range and town are you looking at?',
  'Borrower: Nassau County, around six fifty, with ten percent down. Credit is about seven twenty.',
  'Agent: I will email the document list today and call you Friday. Please send pay stubs and two months of bank statements.',
  'Borrower: Please do not call my current lender.',
].join('\n')

function liveEnv() {
  process.env.ASSISTANT_DEMO_MODE = 'false'
  process.env.FOLLOW_UP_BOSS_API_KEY = 'test-key'
  process.env.CALL_SUMMARIES_ENABLED = 'true'
  process.env.LOA_REMINDERS_ENABLED = 'false'
  process.env.CORDEIRA_LINE_ALERTS_ENABLED = 'false'
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_BASE_URL
  delete process.env.NETLIFY_AI_GATEWAY_KEY
  delete process.env.NETLIFY_AI_GATEWAY_BASE_URL
  delete process.env.OPENROUTER_API_KEY
  delete process.env.OPENROUTER_BASE_URL
  delete process.env.COMMAND_MODEL
}

function call(overrides: Record<string, unknown> = {}) {
  return {
    id: 44,
    personId: 9,
    userId: 16,
    userName: 'Frankie Cordeira',
    created: '2026-10-07T18:30:00.000Z',
    duration: 180,
    isIncoming: true,
    outcome: 'Interested',
    note: 'Left a reminder to send the document checklist. This agent log is not the transcript.',
    recordingUrl: 'Content is hidden for privacy reasons.',
    ...overrides,
  }
}

function deps(notes: { subject?: string; body?: string }[], extra: Partial<CallSummaryDeps> = {}): CallSummaryDeps & {
  notes: { subject?: string; body?: string }[]
  summarize: Mock
} {
  const summarize = (extra.summarize ??
    vi.fn(async () => ({
      purpose: 'Purchase pre-approval',
      recap: ['Reviewed a Nassau County purchase and the documents Frankie will send.'],
      borrower: ['Income: about $90,000 at the hospital for six years.'],
      quotes: ['Please do not call my current lender.'],
    }))) as Mock
  return {
    notes,
    listNotes: async () => notes.map((note) => ({ subject: note.subject, body: note.body })),
    loadPerson: async () => ({ name: 'Ada Buyer' }),
    loadTranscript: async () => null,
    postNote: async (note) => {
      notes.push(note)
    },
    ...extra,
    summarize,
  }
}

beforeEach(() => {
  liveEnv()
  getStoreMock.mockReset()
  getStoreMock.mockImplementation(() => {
    throw new Error('The environment has not been configured to use Netlify Blobs')
  })
  resetCallSummaryStoreForTests()
})

afterEach(() => {
  delete process.env.FOLLOW_UP_BOSS_API_KEY
  delete process.env.CALL_SUMMARIES_ENABLED
  delete process.env.LOA_REMINDERS_ENABLED
  delete process.env.CORDEIRA_LINE_ALERTS_ENABLED
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_BASE_URL
  delete process.env.NETLIFY_AI_GATEWAY_KEY
  delete process.env.NETLIFY_AI_GATEWAY_BASE_URL
  delete process.env.OPENROUTER_API_KEY
  delete process.env.OPENROUTER_BASE_URL
  process.env.ASSISTANT_DEMO_MODE = 'true'
  resetCallSummaryStoreForTests()
  vi.unstubAllGlobals()
})

describe('call summary formatting', () => {
  it('formats an Eastern Time title and omits sections with nothing to say', () => {
    const whenLabel = formatCallStamp('2026-10-07T18:30:00.000Z')
    expect(whenLabel).toBe('Oct 7, 2026 2:30 PM ET')
    expect(formatCallStamp('2026-01-15T14:05:00.000Z')).toBe('Jan 15, 2026 9:05 AM ET')
    expect(formatDuration(724)).toBe('12 min 4 sec')
    expect(formatDuration(60)).toBe('1 min')
    expect(formatDuration(45)).toBe('45 sec')

    const note = formatSummaryNote({
      callId: 44,
      whenLabel,
      agentName: 'Frankie Cordeira',
      personName: 'Ada Buyer',
      direction: 'Inbound',
      durationLabel: formatDuration(724),
      outcome: 'Interested',
      sections: {
        purpose: 'Purchase pre-approval',
        recap: ['Talked through a Nassau County purchase.'],
        borrower: [],
        concerns: [' '],
        quotes: ['Please do not call my current lender.'],
      },
    })
    expect(note.subject).toBe('LoanPilot Call Summary - Oct 7, 2026 2:30 PM ET')
    expect(note.body).toContain('Agent: Frankie Cordeira')
    expect(note.body).toContain('Borrower: Ada Buyer')
    expect(note.body).toContain('When: Oct 7, 2026 2:30 PM ET')
    expect(note.body).toContain('Duration: 12 min 4 sec')
    expect(note.body).toContain('Direction: Inbound')
    expect(note.body).toContain('Purpose')
    expect(note.body).toContain('Purchase pre-approval')
    expect(note.body).toContain('Recap')
    expect(note.body).toContain('• Talked through a Nassau County purchase.')
    expect(note.body).not.toContain('Borrower situation')
    expect(note.body).not.toContain('Concerns and objections')
    expect(note.body).not.toContain('Documents requested')
    expect(note.body).toContain('Notable quotes')
    expect(note.body.endsWith('LoanPilot-call-id:44')).toBe(true)
    expect(noteMentionsCall({ body: note.body }, 44)).toBe(true)
    expect(noteMentionsCall({ body: 'LoanPilot-call-id:440' }, 44)).toBe(false)
  })

  it('reads transcript fields and ignores the agent note, the recording placeholder, and a short summary', () => {
    expect(extractTranscript(call())).toBe('')
    expect(extractTranscript(call({ summary: 'Short FUB summary that is not a transcript.' }))).toBe('')
    expect(extractTranscript(call({ transcript }))).toBe(transcript)
    expect(
      extractTranscript(
        call({
          recording: {
            segments: [
              { speaker: 'Agent', text: 'Let us review the purchase.' },
              { speaker: 'Borrower', text: 'I want a conventional loan in Nassau County this spring.' },
            ],
          },
        }),
      ),
    ).toContain('Borrower: I want a conventional loan in Nassau County this spring.')
    expect(extractTranscript({ text: transcript })).toBe(transcript)
    expect(parseSummarySections({ purpose: '', recap: ['Talked about a purchase.'], borrower: { income: '$90,000', credit: '' }, concerns: [] })).toEqual({
      recap: ['Talked about a purchase.'],
      borrower: ['Income: $90,000'],
    })
  })
})

describe('call summary posting', () => {
  it('waits for a late transcript and then posts once', async () => {
    const notes: { subject?: string; body?: string }[] = []
    const fx = deps(notes)
    const first = await summarizeLoadedCall(call(), fx)
    expect(first.skipped).toBe('no_transcript')
    expect(fx.summarize).not.toHaveBeenCalled()
    expect(notes).toHaveLength(0)

    const second = await summarizeLoadedCall(call({ transcript }), fx)
    expect(second.posted).toBe(true)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.subject).toBe('LoanPilot Call Summary - Oct 7, 2026 2:30 PM ET')
    expect(notes[0]?.body).toContain('Borrower: Ada Buyer')
    expect(notes[0]?.body).toContain('LoanPilot-call-id:44')
    expect(notes[0]?.body).not.toContain('This agent log is not the transcript')
    expect(fx.summarize).toHaveBeenCalledTimes(1)

    const third = await summarizeLoadedCall(call({ transcript }), fx)
    expect(third.skipped).toBe('duplicate')
    expect(notes).toHaveLength(1)
    expect(fx.summarize).toHaveBeenCalledTimes(1)

    resetCallSummaryStoreForTests()
    const afterBlobReset = await summarizeLoadedCall(call({ transcript }), fx)
    expect(afterBlobReset.skipped).toBe('duplicate')
    expect(notes).toHaveLength(1)
    expect(fx.summarize).toHaveBeenCalledTimes(1)
  })

  it('skips a missing, tiny, or very short transcript without claiming the call', async () => {
    const notes: { subject?: string; body?: string }[] = []
    const fx = deps(notes)
    expect((await summarizeLoadedCall(call({ transcript: '   ' }), fx)).skipped).toBe('no_transcript')
    expect((await summarizeLoadedCall(call({ transcript: 'x'.repeat(79) }), fx)).skipped).toBe('no_transcript')
    expect((await summarizeLoadedCall(call({ duration: 29, transcript }), fx)).skipped).toBe('short_call')
    expect((await summarizeLoadedCall(call({ personId: 0, transcript }), fx)).skipped).toBe('no_person')
    expect(fx.summarize).not.toHaveBeenCalled()
    expect(notes).toHaveLength(0)

    const posted = await summarizeLoadedCall(call({ duration: 30, transcript: 'x'.repeat(80) }), fx)
    expect(posted.posted).toBe(true)
    expect(notes).toHaveLength(1)
  })

  it('posts one note when two workers summarize the same call', async () => {
    const notes: { subject?: string; body?: string }[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const summarize = vi.fn(async () => {
      await gate
      return { purpose: 'Purchase pre-approval', recap: ['One recap point from the transcript.'] }
    })
    const fx = deps(notes, { summarize })
    const pending = Promise.all([summarizeLoadedCall(call({ transcript }), fx), summarizeLoadedCall(call({ transcript }), fx)])
    await vi.waitFor(() => expect(summarize).toHaveBeenCalledTimes(1))
    release()
    const [first, second] = await pending
    expect([first.posted, second.posted].filter(Boolean)).toHaveLength(1)
    expect([first.skipped, second.skipped]).toContain('duplicate')
    expect(notes).toHaveLength(1)
  })

  it('does not post when the blob claim cannot be proven', async () => {
    getStoreMock.mockImplementation((input: unknown) => {
      const name = typeof input === 'string' ? input : (input as { name?: string } | null)?.name
      if (name !== 'loanpilot-call-summaries') throw new Error('The environment has not been configured to use Netlify Blobs')
      return {
        async get() {
          return { token: 'someone-else' }
        },
        async setJSON() {
          return { modified: true, etag: 'etag-1' }
        },
        async delete() {
          return undefined
        },
      }
    })
    const notes: { subject?: string; body?: string }[] = []
    const fx = deps(notes)
    const result = await summarizeLoadedCall(call({ transcript }), fx)
    expect(result.skipped).toBe('duplicate')
    expect(notes).toHaveLength(0)
    expect(fx.summarize).not.toHaveBeenCalled()
    expect(getStoreMock).toHaveBeenCalledWith({ name: 'loanpilot-call-summaries', consistency: 'strong' })
  })

  it('does not post when the notes pre-check fails, and does not invent a summary without a model', async () => {
    const notes: { subject?: string; body?: string }[] = []
    const blocked = deps(notes, {
      listNotes: async () => {
        throw new Error('notes down')
      },
    })
    expect((await summarizeLoadedCall(call({ transcript }), blocked)).skipped).toBe('notes_unavailable')
    expect((await summarizeLoadedCall(call({ transcript }), blocked)).skipped).toBe('duplicate')
    expect(blocked.summarize).not.toHaveBeenCalled()
    expect(notes).toHaveLength(0)

    resetCallSummaryStoreForTests()
    const postNote = vi.fn(async () => undefined)
    const missing = await summarizeLoadedCall(call({ id: 45, transcript }), { postNote, listNotes: async () => [], loadPerson: async () => ({ name: 'Ada Buyer' }), loadTranscript: async () => null })
    expect(missing.skipped).toBe('no_llm')
    expect(postNote).not.toHaveBeenCalled()
    const later = await summarizeLoadedCall(call({ id: 45, transcript }), {
      postNote,
      listNotes: async () => [],
      loadPerson: async () => ({ name: 'Ada Buyer' }),
      loadTranscript: async () => null,
      summarize: async () => ({ purpose: 'Refinance question' }),
    })
    expect(later.posted).toBe(true)
    expect(postNote).toHaveBeenCalledTimes(1)
  })

  it('releases the claim when the model or the note write fails so a later pass can post', async () => {
    const notes: { subject?: string; body?: string }[] = []
    let failModel = true
    const fx = deps(notes, {
      summarize: async () => {
        if (failModel) throw new Error('gateway down')
        return { purpose: 'Purchase pre-approval' }
      },
    })
    expect((await summarizeLoadedCall(call({ transcript }), fx)).skipped).toBe('llm_failed')
    failModel = false
    expect((await summarizeLoadedCall(call({ transcript }), fx)).posted).toBe(true)
    expect(notes).toHaveLength(1)

    resetCallSummaryStoreForTests()
    notes.length = 0
    let failPost = true
    const retry = deps([], {
      postNote: async (note) => {
        if (failPost) throw new Error('Follow Up Boss notes failed')
        notes.push(note)
      },
    })
    expect((await summarizeLoadedCall(call({ id: 46, transcript }), retry)).skipped).toBe('post_failed')
    failPost = false
    expect((await summarizeLoadedCall(call({ id: 46, transcript }), retry)).posted).toBe(true)
    expect(notes).toHaveLength(1)
  })

  it('sweeps the last day of calls and skips an older call or one that still has no transcript', async () => {
    const notes: { subject?: string; body?: string }[] = []
    const now = new Date('2026-10-07T18:00:00.000Z')
    const fx = deps(notes)
    const result = await runCallSummarySweep({
      ...fx,
      now,
      listCalls: async () => [
        call({ id: 1, created: '2026-10-05T12:00:00.000Z', transcript }),
        call({ id: 2, created: '2026-10-07T16:00:00.000Z', transcript: '' }),
        call({ id: 3, created: '2026-10-07T17:00:00.000Z', transcript }),
      ],
    })
    expect(result.checked).toBe(2)
    expect(result.posted).toBe(1)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.body).toContain('LoanPilot-call-id:3')
    expect(fx.summarize).toHaveBeenCalledTimes(1)
  })
})

describe('call summary webhook', () => {
  it('does not call the network while the flag is off', async () => {
    delete process.env.CALL_SUMMARIES_ENABLED
    const fetchMock = vi.fn(() => {
      throw new Error('network')
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await fubWebhook(
      new Request('https://site.example/api/webhooks/fub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'callsUpdated', resourceIds: [44] }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { reminders?: { skipped?: string }; leads?: unknown }
    expect(body.reminders?.skipped).toBe('disabled')
    expect(body.leads).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
    const skipped = await handleFubCallSummaryWebhook({ event: 'callsCreated', resourceIds: [44] }, { loadCall: fetchMock })
    expect(skipped.skipped).toBe('disabled')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('summarizes on callsUpdated after callsCreated had no transcript, and does not post twice', async () => {
    process.env.OPENAI_BASE_URL = 'https://gateway.example/v1'
    process.env.OPENAI_API_KEY = 'test-gateway'
    let withTranscript = false
    const notes: { personId?: number; subject?: string; body?: string; isHtml?: boolean; mentions?: unknown }[] = []
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        urls.push(`${init?.method ?? 'GET'} ${url}`)
        if (url === 'https://api.followupboss.com/v1/calls/44') {
          return new Response(JSON.stringify(call({ transcript: withTranscript ? transcript : undefined })), { status: 200 })
        }
        if (url.includes('/calls/44/transcript') || url.includes('/calls/44/transcription')) {
          return new Response('not found', { status: 404 })
        }
        if (url === 'https://api.followupboss.com/v1/people/9') {
          return new Response(JSON.stringify({ id: 9, name: 'Ada Buyer' }), { status: 200 })
        }
        if (url.startsWith('https://api.followupboss.com/v1/notes?')) {
          return new Response(JSON.stringify({ notes: notes.map((note, index) => ({ id: index + 1, ...note })) }), { status: 200 })
        }
        if (url === 'https://api.followupboss.com/v1/notes' && init?.method === 'POST') {
          notes.push(JSON.parse(String(init.body ?? '{}')) as (typeof notes)[number])
          return new Response(JSON.stringify({ id: notes.length }), { status: 200 })
        }
        if (url === 'https://gateway.example/v1/chat/completions') {
          return new Response(
            JSON.stringify({
              id: 'chatcmpl-test',
              object: 'chat.completion',
              created: 0,
              model: 'gpt-4o-mini',
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: JSON.stringify({
                      purpose: 'Purchase pre-approval',
                      recap: ['Ada wants to buy in Nassau County and Frankie will send the document list.'],
                      borrower: ['Income: about $90,000.'],
                      concerns: [],
                      quotes: ['Please do not call my current lender.'],
                    }),
                  },
                  finish_reason: 'stop',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response('unexpected', { status: 500 })
      }),
    )

    const event = (name: string) =>
      fubWebhook(
        new Request('https://site.example/api/webhooks/fub', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: name, resourceIds: [44], uri: 'https://api.followupboss.com/v1/calls?id=44' }),
        }),
      )

    const created = await event('callsCreated')
    expect(created.status).toBe(200)
    expect(notes).toHaveLength(0)
    expect(urls.some((url) => url.includes('gateway.example'))).toBe(false)
    expect(urls.some((url) => url.includes('/calls/44/transcript'))).toBe(true)

    withTranscript = true
    const updated = await event('callsUpdated')
    expect(updated.status).toBe(200)
    const updatedBody = (await updated.json()) as { reminders?: { skipped?: string } }
    expect(updatedBody.reminders?.skipped).toBe('disabled')
    expect(notes).toHaveLength(1)
    expect(notes[0]?.personId).toBe(9)
    expect(notes[0]?.isHtml).toBe(false)
    expect(notes[0]?.mentions).toBeUndefined()
    expect(notes[0]?.subject).toBe('LoanPilot Call Summary - Oct 7, 2026 2:30 PM ET')
    expect(notes[0]?.body).toContain('Agent: Frankie Cordeira')
    expect(notes[0]?.body).toContain('Borrower: Ada Buyer')
    expect(notes[0]?.body).toContain('Income: about $90,000.')
    expect(notes[0]?.body).toContain('LoanPilot-call-id:44')
    expect(notes[0]?.body).not.toContain('Concerns and objections')
    expect(urls.filter((url) => url.includes('gateway.example'))).toHaveLength(1)

    await event('callsUpdated')
    expect(notes).toHaveLength(1)
    expect(urls.filter((url) => url.includes('gateway.example'))).toHaveLength(1)
  })
})
