/** "Picks lock in 2d 4h" / "…in 3h 12m" / "…in 14m" / past due message. */
export function countdownText(locksAtIso: string, nowMs: number): string {
  const remaining = new Date(locksAtIso).getTime() - nowMs
  if (remaining <= 0) return 'Bell time — picks lock any minute'
  const mins = Math.floor(remaining / 60_000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (days > 0) return `Picks lock in ${days}d ${hours}h`
  if (hours > 0) return `Picks lock in ${hours}h ${m}m`
  return `Picks lock in ${m}m`
}
