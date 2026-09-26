import { afterEach, describe, expect, it } from 'vitest'
import { bandForScore, scoreLead } from '../../netlify/functions/_shared/leadScore'
import { demoLeadBoard, handleFubWebhook, shouldRewriteScore } from '../../netlify/functions/_shared/leadHeat'
import { shiftDateKey } from '../../netlify/functions/_shared/hubTypes'
import { escalationPlan, followUpPlan, loanOfficer, loanOfficerAssistant } from '../../netlify/functions/_shared/team'

const now = new Date('2026-09-25T15:00:00.000Z')

afterEach(() => {
  delete process.env.FUB_LO_NAME
  delete process.env.FUB_LOA_NAME
  delete process.env.FUB_LO_USER_ID
  delete process.env.FUB_LOA_USER_ID
})

describe('scoreLead', () => {
  it('scores a fresh ready-to-buy lead as hot', () => {
    const result = scoreLead({
      stage: 'Lead',
      recentText: 'Docs are ready and we are ready to buy. Can you send the pre-approval?',
      lastInboundAt: new Date(now.getTime() - 2 * 3_600_000).toISOString(),
      now,
    })
    expect(result.excluded).toBe(false)
    expect(result.score).toBe(92)
    expect(result.band).toBe('hot')
    expect(result.reasons.some((reason) => /24 hours/.test(reason))).toBe(true)
    expect(result.reasons.some((reason) => /pre-approval/.test(reason))).toBe(true)
  })

  it('scores refinance interest in the last 72 hours as warm', () => {
    const result = scoreLead({
      stage: 'Lead',
      recentText: 'Thinking about refinance rates this week.',
      lastInboundAt: new Date(now.getTime() - 36 * 3_600_000).toISOString(),
      now,
    })
    expect(result.score).toBe(72)
    expect(result.band).toBe('warm')
  })

  it('scores a quiet nurture refinance as cool', () => {
    const result = scoreLead({
      stage: 'Nurture',
      recentText: 'Still thinking about a refinance later this year.',
      lastInboundAt: new Date(now.getTime() - 5 * 86_400_000).toISOString(),
      lastContactAt: new Date(now.getTime() - 5 * 86_400_000).toISOString(),
      now,
    })
    expect(result.score).toBe(42)
    expect(result.band).toBe('cool')
  })

  it('cools a lead who has gone quiet', () => {
    const result = scoreLead({
      stage: 'Lead',
      recentText: 'Thanks for the info a while back.',
      lastContactAt: new Date(now.getTime() - 40 * 86_400_000).toISOString(),
      now,
    })
    expect(result.score).toBe(20)
    expect(result.band).toBe('cold')
    expect(result.reasons.some((reason) => /Quiet for 40 days/.test(reason))).toBe(true)
  })

  it('does not cool a lead who just wrote in', () => {
    const result = scoreLead({
      stage: 'Lead',
      recentText: 'Checking in',
      lastInboundAt: new Date(now.getTime() - 3 * 3_600_000).toISOString(),
      lastContactAt: new Date(now.getTime() - 40 * 86_400_000).toISOString(),
      now,
    })
    expect(result.reasons.some((reason) => /Quiet/.test(reason))).toBe(false)
    expect(result.score).toBe(68)
    expect(result.band).toBe('cool')
  })

  it('treats an appointment request on a fresh lead as hot', () => {
    const result = scoreLead({
      stage: 'Lead',
      recentText: 'Can we talk tomorrow?',
      lastInboundAt: now.toISOString(),
      appointmentRequested: true,
      now,
    })
    expect(result.score).toBe(90)
    expect(result.band).toBe('hot')
    expect(result.reasons).toContain('Appointment requested')
  })

  it('caps stacked engagement keywords', () => {
    const result = scoreLead({
      stage: 'Hot Lead',
      recentText: 'Docs are ready, ready to buy, pre-approval, refinance now, and the rate.',
      lastInboundAt: now.toISOString(),
      now,
    })
    expect(result.score).toBe(100)
    expect(result.band).toBe('hot')
  })

  it('excludes vendors, title, and ops contacts', () => {
    expect(scoreLead({ stage: 'Vendor', now }).excluded).toBe(true)
    expect(scoreLead({ stage: 'Lead', tags: ['Title'], now }).band).toBe('excluded')
    expect(scoreLead({ stage: 'Lead', opsContact: true, now }).score).toBe(0)
  })

  it('maps score boundaries to bands', () => {
    expect(bandForScore(100)).toBe('hot')
    expect(bandForScore(90)).toBe('hot')
    expect(bandForScore(89)).toBe('warm')
    expect(bandForScore(70)).toBe('warm')
    expect(bandForScore(69)).toBe('cool')
    expect(bandForScore(40)).toBe('cool')
    expect(bandForScore(39)).toBe('cold')
    expect(bandForScore(0)).toBe('cold')
  })
})

describe('team routing', () => {
  it('defaults to Joseph Cordeira and Frank Cordeira', () => {
    expect(loanOfficer().name).toBe('Joseph Cordeira')
    expect(loanOfficer().title).toBe('Loan Officer')
    expect(loanOfficerAssistant().name).toBe('Frank Cordeira')
    expect(loanOfficerAssistant().role).toBe('loa')
  })

  it('reads names and user ids from env', () => {
    process.env.FUB_LO_NAME = 'Jo Test'
    process.env.FUB_LO_USER_ID = '42'
    process.env.FUB_LOA_NAME = '  '
    process.env.FUB_LOA_USER_ID = '0'
    expect(loanOfficer()).toMatchObject({ name: 'Jo Test', userId: 42, role: 'lo' })
    expect(loanOfficerAssistant().name).toBe('Frank Cordeira')
    expect(loanOfficerAssistant().userId).toBeUndefined()
  })

  it('assigns hot calls to Joseph today and warm or cool follow-ups to Frank', () => {
    const hot = followUpPlan({ score: 92, band: 'hot', reasons: [], excluded: false }, 'Alex Buyer', now)
    const warm = followUpPlan({ score: 72, band: 'warm', reasons: [], excluded: false }, 'Jordan Hale', now)
    const cool = followUpPlan({ score: 42, band: 'cool', reasons: [], excluded: false }, 'Sam Rivera', now)
    const cold = followUpPlan({ score: 20, band: 'cold', reasons: [], excluded: false }, 'Pat Nguyen', now)

    expect(hot).toMatchObject({
      assigneeName: 'Joseph Cordeira',
      assigneeRole: 'lo',
      taskType: 'Call',
      dueDate: shiftDateKey(now, 0),
    })
    expect(warm).toMatchObject({
      assigneeName: 'Frank Cordeira',
      assigneeRole: 'loa',
      taskType: 'Text',
      dueDate: shiftDateKey(now, 1),
    })
    expect(cool).toMatchObject({
      assigneeName: 'Frank Cordeira',
      taskType: 'Follow Up',
      dueDate: shiftDateKey(now, 5),
    })
    expect(cold).toBeNull()
  })

  it('sends escalations to Joseph the same day', () => {
    expect(escalationPlan('Alex Buyer', now)).toMatchObject({
      assigneeName: 'Joseph Cordeira',
      taskType: 'Call',
      dueDate: shiftDateKey(now, 0),
    })
  })
})

describe('demo lead board', () => {
  it('ranks sample leads for Joseph and Frank without a FUB key', () => {
    const leads = demoLeadBoard(now)
    expect(leads.map((lead) => [lead.name, lead.band, lead.score, lead.assignee])).toEqual([
      ['Alex Buyer', 'hot', 92, 'Joseph Cordeira'],
      ['Jordan Hale', 'warm', 72, 'Frank Cordeira'],
      ['Sam Rivera', 'cool', 42, 'Frank Cordeira'],
      ['Pat Nguyen', 'cold', 20, undefined],
    ])
  })

  it('routes a webhook hot lead to Joseph and keeps a warm lead with Frank', async () => {
    process.env.ASSISTANT_DEMO_MODE = 'true'
    const hot = await handleFubWebhook(
      {
        event: 'peopleUpdated',
        person: {
          id: 4242,
          name: 'Casey Hot',
          stage: 'Lead',
          text: 'Docs are ready and we are ready to buy. Pre-approval please.',
          lastInboundAt: now.toISOString(),
        },
      },
      now,
    )
    expect(hot.leads[0]).toMatchObject({
      name: 'Casey Hot',
      band: 'hot',
      score: 92,
      assignee: 'Joseph Cordeira',
      assigneeRole: 'lo',
      taskType: 'Call',
    })
    expect(hot.leads[0]?.taskId).toEqual(expect.any(Number))

    const warm = await handleFubWebhook(
      {
        event: 'peopleUpdated',
        person: {
          id: 4243,
          name: 'Riley Warm',
          stage: 'Lead',
          text: 'Thinking about refinance rates this week.',
          lastInboundAt: new Date(now.getTime() - 36 * 3_600_000).toISOString(),
        },
      },
      now,
    )
    expect(warm.leads[0]).toMatchObject({
      band: 'warm',
      score: 72,
      assignee: 'Frank Cordeira',
      assigneeRole: 'loa',
      taskType: 'Text',
    })
  })

  it('ignores task webhooks so scoring does not loop', async () => {
    const result = await handleFubWebhook({ event: 'tasksCreated', resourceIds: [9] }, now)
    expect(result).toEqual({ skipped: 'tasksCreated', leads: [] })
  })

  it('skips a rewrite when the score has not changed', () => {
    const previous = { score: 92, band: 'hot', scoredAt: new Date(now.getTime() - 60 * 60_000).toISOString() }
    expect(shouldRewriteScore(previous, { score: 92, band: 'hot' }, now)).toBe(false)
    expect(shouldRewriteScore(previous, { score: 70, band: 'warm' }, now)).toBe(true)
    expect(shouldRewriteScore(previous, { score: 92, band: 'hot' }, now, true)).toBe(true)
  })
})
