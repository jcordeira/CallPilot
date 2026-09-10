import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { StoreProvider, initialState, type AppState } from '../state/store'
import { TimeZoneProvider } from '../state/timezone'

export function renderApp(ui: ReactNode, opts: { route?: string; state?: Partial<AppState>; tz?: string } = {}) {
  const state: AppState = { ...initialState(), ...(opts.state ?? {}) }
  return render(
    <MemoryRouter initialEntries={[opts.route ?? '/']}>
      <StoreProvider initial={state}>
        <TimeZoneProvider initial={opts.tz ?? 'America/New_York'}>{ui}</TimeZoneProvider>
      </StoreProvider>
    </MemoryRouter>,
  )
}
