import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPage } from './SettingsPage'
import { renderApp } from '../test/render'

describe('SettingsPage', () => {
  it('reflects the buffer selection in the hours summary', async () => {
    const user = userEvent.setup()
    renderApp(<SettingsPage />, { route: '/settings' })
    expect(screen.getByText('15 minutes')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: '60 min' }))
    expect(screen.getByText('60 minutes')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'None' }))
    expect(screen.getByText('None', { selector: '.rules__value' })).toBeInTheDocument()
  })

  it('toggles connections, emails and breaks', async () => {
    const user = userEvent.setup()
    renderApp(<SettingsPage />, { route: '/settings' })
    const icloud = screen.getByRole('switch', { name: /iCloud Calendar/ })
    expect(icloud).toHaveAttribute('aria-checked', 'false')
    await user.click(icloud)
    expect(icloud).toHaveAttribute('aria-checked', 'true')

    const followUp = screen.getByRole('checkbox', { name: /Follow-up after the call/ })
    expect(followUp).toHaveAttribute('aria-checked', 'false')
    await user.click(followUp)
    expect(followUp).toHaveAttribute('aria-checked', 'true')

    const wrap = screen.getByRole('switch', { name: /End-of-week wrap-up/ })
    await user.click(wrap)
    expect(wrap).toHaveAttribute('aria-checked', 'true')
  })

  it('adds, edits and deletes a recurring break', async () => {
    const user = userEvent.setup()
    renderApp(<SettingsPage />, { route: '/settings' })
    await user.click(screen.getByRole('button', { name: '+ Add a break' }))
    await user.click(screen.getByRole('button', { name: 'Add break' }))
    expect(screen.getByText('Give the break a name.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Name'), 'School pickup')
    await user.selectOptions(screen.getByLabelText('Start'), '15')
    await user.selectOptions(screen.getByLabelText('End'), '15.5')
    await user.click(screen.getByRole('button', { name: 'Sat' }))
    await user.click(screen.getByRole('button', { name: 'Add break' }))
    expect(screen.getByText('School pickup')).toBeInTheDocument()
    expect(screen.getByText('3:00 – 3:30 PM · Mon–Sat')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit School pickup' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.queryByText('School pickup')).not.toBeInTheDocument()
  })
})
