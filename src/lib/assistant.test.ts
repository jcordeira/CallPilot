import { describe, expect, it } from 'vitest'
import { classifySender, shouldAutoRespond } from '../../netlify/functions/_shared/classify'
import { DEFAULT_SETTINGS } from '../../netlify/functions/_shared/types'
import type { IncomingMessage } from '../../netlify/functions/_shared/types'
import { generateReply } from '../../netlify/functions/_shared/ai'
import { parseFromHeader } from '../../netlify/functions/_shared/gmail'

function msg(partial: Partial<IncomingMessage>): IncomingMessage {
  return {
    id: '1',
    channel: 'gmail',
    body: 'Hello',
    receivedAt: new Date().toISOString(),
    ...partial,
  }
}

describe('classifySender', () => {
  it('marks ops domains as ops', () => {
    const kind = classifySender(
      msg({ fromEmail: 'desk@underwriting.example.com', subject: 'File update' }),
      DEFAULT_SETTINGS,
    )
    expect(kind).toBe('ops')
  })

  it('marks mortgage questions as leads', () => {
    const kind = classifySender(
      msg({
        fromEmail: 'alex@gmail.com',
        subject: 'Pre-approval question',
        body: 'What documents do I need for a mortgage pre-approval?',
      }),
      DEFAULT_SETTINGS,
    )
    expect(kind).toBe('lead')
  })

  it('trusts Follow Up Boss lead flag', () => {
    const kind = classifySender(msg({ fromEmail: 'x@y.com' }), DEFAULT_SETTINGS, true)
    expect(kind).toBe('lead')
  })

  it('blocks auto-reply for ops when leadOnly', () => {
    const gate = shouldAutoRespond('ops', DEFAULT_SETTINGS)
    expect(gate.ok).toBe(false)
  })
})

describe('parseFromHeader', () => {
  it('parses name and email', () => {
    expect(parseFromHeader('Alex Buyer <alex.buyer@gmail.com>')).toEqual({
      name: 'Alex Buyer',
      email: 'alex.buyer@gmail.com',
    })
  })
})

describe('generateReply demo', () => {
  it('answers document questions without escalating', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'true'
    const result = await generateReply(
      msg({
        subject: 'Documents?',
        body: 'What documents do I need for pre-approval?',
        fromName: 'Alex Buyer',
      }),
      DEFAULT_SETTINGS,
    )
    expect(result.canAnswer).toBe(true)
    expect(result.replyBody.toLowerCase()).toMatch(/pay stub|w-2|bank/)
  })

  it('escalates wire / sensitive topics', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'true'
    const result = await generateReply(
      msg({ subject: 'Wire', body: 'Please send wire instructions for closing.' }),
      DEFAULT_SETTINGS,
    )
    expect(result.canAnswer).toBe(false)
    expect(result.escalateReason).toMatch(/wire/i)
  })
})
