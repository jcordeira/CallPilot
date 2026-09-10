import './Checkbox.css'

interface Props {
  checked: boolean
}

/** Visual-only 18px checkbox; the wrapping row owns the click and a11y state. */
export function CheckboxMark({ checked }: Props) {
  return (
    <span className={`checkmark${checked ? ' checkmark--on' : ''}`} aria-hidden="true">
      {checked ? '✓' : ''}
    </span>
  )
}
