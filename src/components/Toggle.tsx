import './Toggle.css'

interface Props {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}

/** 42×24 pill switch. Only the knob animates (left .16s ease). */
export function Toggle({ checked, onChange, label }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle${checked ? ' toggle--on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__knob" />
    </button>
  )
}
