import { useState } from 'react'

export function LoginPage({ onSuccess, passwordSet = true }: { onSuccess: () => void; passwordSet?: boolean }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <div className="login">
      <form
        className="card login__card"
        onSubmit={(event) => {
          event.preventDefault()
          setBusy(true)
          void fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
          })
            .then(async (res) => {
              const body = (await res.json().catch(() => ({}))) as { error?: string }
              if (!res.ok) throw new Error(body.error || 'Could not sign in')
              onSuccess()
            })
            .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not sign in'))
            .finally(() => setBusy(false))
        }}
      >
        <p className="eyebrow">LoanPilot</p>
        <h1 className="page-title">Sign in</h1>
        <p>The Hub holds Joseph&apos;s calendar. Use the hub password to continue.</p>
        {!passwordSet && <p className="cal__error">Set HUB_PASSWORD before anyone can sign in.</p>}
        <label className="cal__field">
          Password
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="cal__error">{error}</p>}
        <button type="submit" className="btn btn--primary" disabled={busy || !passwordSet}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
