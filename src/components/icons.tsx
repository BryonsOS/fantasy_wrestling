// Single-style inline icon set. No emoji in the UI.

export function BeltIcon({ height = 16 }: { height?: number }) {
  const width = (height / 24) * 44
  return (
    <svg width={width} height={height} viewBox="0 0 44 24" fill="none" aria-hidden="true">
      <rect x="1" y="8" width="42" height="8" rx="1.5" fill="#2b2117" stroke="#e8b64c" strokeWidth="1.5" />
      <circle cx="8" cy="12" r="2.6" fill="#e8b64c" />
      <circle cx="36" cy="12" r="2.6" fill="#e8b64c" />
      <circle cx="22" cy="12" r="9" fill="#e8b64c" stroke="#f3d489" strokeWidth="1.5" />
      <path
        d="M22 6.6l1.7 3.4 3.8.6-2.7 2.7.6 3.8-3.4-1.8-3.4 1.8.6-3.8-2.7-2.7 3.8-.6z"
        fill="#151310"
      />
    </svg>
  )
}

export function CameraIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="3.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

export function LiveDot() {
  return <span className="live-dot" aria-hidden="true" />
}
