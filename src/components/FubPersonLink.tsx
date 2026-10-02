import type { ReactNode } from 'react'
import { fubPersonUrl, matchPersonInText, type NamedPerson } from '../lib/fubLink'

export function FubPersonLink({ personId, className, children }: { personId?: number; className?: string; children: ReactNode }) {
  const href = fubPersonUrl(personId)
  if (!href) return <span className={className}>{children}</span>
  return (
    <a className={className ? `${className} fub-person` : 'fub-person'} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

export function TextWithPerson({ text, people }: { text: string; people: NamedPerson[] }) {
  const match = matchPersonInText(text, people)
  if (!match) return <>{text}</>
  return (
    <>
      {text.slice(0, match.index)}
      <FubPersonLink personId={match.personId}>{match.label}</FubPersonLink>
      {text.slice(match.index + match.label.length)}
    </>
  )
}
