import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

type DemoState = boolean | null

const DemoContext = createContext<DemoState>(null)

export function DemoModeProvider({ children }: { children: ReactNode }) {
  const [demo, setDemo] = useState<DemoState>(null)
  useEffect(() => {
    let cancelled = false
    void fetch('/api/hub/summary')
      .then((res) => res.json())
      .then((body: { data?: { stats?: { demo?: boolean } } }) => {
        if (!cancelled) setDemo(body?.data?.stats?.demo === true)
      })
      .catch(() => {
        if (!cancelled) setDemo(false)
      })
    return () => {
      cancelled = true
    }
  }, [])
  return <DemoContext.Provider value={demo}>{children}</DemoContext.Provider>
}

export function useDemoMode(): DemoState {
  return useContext(DemoContext)
}

/** Booking screens are fixture data. Live mode shows an empty state instead of sample people. */
export function FixtureScreen({ title, children }: { title: string; children: ReactNode }) {
  const demo = useDemoMode()
  if (demo === true) return children
  return (
    <div className="page page--narrow">
      <h1 className="page-title">{title}</h1>
      <p className="page-subtitle">
        This screen is the demo booking calendar. Live LoanPilot uses the Hub for Follow Up Boss tasks and Google Calendar.
      </p>
      <p>
        <Link to="/hub" className="btn btn--primary">
          Back to Hub
        </Link>
      </p>
    </div>
  )
}
