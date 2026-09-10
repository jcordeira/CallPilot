import { useId, useState } from 'react'
import { Modal } from './Modal'
import { useStore, newId } from '../state/store'
import { isEmail } from '../lib/people'
import type { TeamMember } from '../lib/types'

interface Props {
  onClose: () => void
  onInvited?: (member: TeamMember) => void
}

export function InviteModal({ onClose, onInvited }: Props) {
  const { state, dispatch } = useStore()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  const submit = () => {
    if (!name.trim()) return setError('Enter their name.')
    if (!isEmail(email)) return setError('Enter a valid email address.')
    if (state.team.some((m) => m.email.toLowerCase() === email.trim().toLowerCase())) return setError('Someone with that email is already on the team.')
    const member: TeamMember = {
      id: newId('user'),
      name: name.trim(),
      email: email.trim(),
      role: role.trim() || 'Team member',
      status: 'invited',
      hours: { start: 9, end: 17, days: [1, 2, 3, 4, 5] },
    }
    dispatch({ type: 'team/invite', member })
    onInvited?.(member)
    onClose()
  }

  return (
    <Modal
      title="Invite user"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--primary" onClick={submit}>Send invite</button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor={`${id}-name`}>Name</label>
        <input id={`${id}-name`} className="input" value={name} onChange={(e) => { setName(e.target.value); setError(null) }} placeholder="Full name" />
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-email`}>Email</label>
        <input id={`${id}-email`} className="input" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(null) }} placeholder="name@company.com" />
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-role`}>Role <span style={{ color: 'var(--text-muted)' }}>(optional)</span></label>
        <input id={`${id}-role`} className="input" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Client success" />
      </div>
      <div className="field__hint">They get their own calendar, booking page, connections and hours. Everyone on the team can see and book into it.</div>
      {error && <div className="field__error" role="alert">{error}</div>}
    </Modal>
  )
}
