import { useEffect, useState } from 'react'

function mediaQuery(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(query)
}

export function useMediaQuery(query: string): boolean {
  const get = () => mediaQuery(query)?.matches ?? false
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    const mq = mediaQuery(query)
    if (!mq) return
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}
