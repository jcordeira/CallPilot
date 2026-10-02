import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { LoginPage } from '../screens/LoginPage'

type AuthValue = { signedIn: boolean; signOut: () => void }

const HubAuthContext = createContext<AuthValue>({ signedIn: false, signOut: () => undefined })

export function useHubAuth(): AuthValue {
  return useContext(HubAuthContext)
}

export function HubAuthGate({ children }: { children: ReactNode }) {
  const skip = import.meta.env.MODE === 'test' || Boolean(import.meta.env.VITEST)
  const [state, setState] = useState<'loading' | 'in' | 'out'>(skip ? 'in' : 'loading')
  const [passwordSet, setPasswordSet] = useState(true)

  useEffect(() => {
    if (skip) return
    void fetch('/api/auth/session')
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { data?: { authenticated?: boolean; passwordSet?: boolean } }
        setPasswordSet(body.data?.passwordSet !== false)
        setState(body.data?.authenticated ? 'in' : 'out')
      })
      .catch(() => setState('out'))
  }, [skip])

  const signOut = () => {
    void fetch('/api/auth/logout', { method: 'POST' }).finally(() => setState('out'))
  }

  if (state === 'loading') return <p className="login">Checking sign-in…</p>
  if (state === 'out') return <LoginPage passwordSet={passwordSet} onSuccess={() => setState('in')} />
  return <HubAuthContext.Provider value={{ signedIn: true, signOut }}>{children}</HubAuthContext.Provider>
}
