import type { Pick, Question } from './types'

/**
 * Winners of a typed-entry question, Price Is Right rules:
 * closest to the actual value WITHOUT going over. Ties all win.
 * Nobody under the actual value -> nobody wins.
 */
export function entryWinners(q: Question, picks: Pick[]): string[] {
  if (q.answer_value == null) return []
  const answer = Number(q.answer_value)
  const valid = picks.filter(
    (p) => p.question_id === q.id && p.entry_value != null && Number(p.entry_value) <= answer,
  )
  if (valid.length === 0) return []
  const best = Math.max(...valid.map((p) => Number(p.entry_value)))
  return valid.filter((p) => Number(p.entry_value) === best).map((p) => p.user_id)
}

/** Whether a question has its result entered. */
export function isScored(q: Question): boolean {
  return q.kind === 'entry' ? q.answer_value != null : q.correct_option_id != null
}

/** Points a user earned across a set of questions. */
export function scoreForUser(userId: string, questions: Question[], picks: Pick[]): number {
  let total = 0
  for (const q of questions) {
    if (q.kind === 'entry') {
      if (entryWinners(q, picks).includes(userId)) total += q.points
    } else {
      if (!q.correct_option_id) continue
      const pick = picks.find((p) => p.user_id === userId && p.question_id === q.id)
      if (pick && pick.option_id === q.correct_option_id) total += q.points
    }
  }
  return total
}

/** Max points available on a set of questions (only ones with a result entered). */
export function pointsAvailable(questions: Question[]): number {
  return questions.filter(isScored).reduce((s, q) => s + q.points, 0)
}

/** Parse "H:MM:SS", "MM:SS", or "SS" into total seconds. Null if invalid. */
export function parseDuration(input: string): number | null {
  const parts = input.trim().split(':')
  if (parts.length === 0 || parts.length > 3) return null
  if (parts.some((p) => !/^\d+$/.test(p.trim()))) return null
  let secs = 0
  for (const p of parts) secs = secs * 60 + parseInt(p.trim(), 10)
  return secs
}

/** Format seconds as "H:MM:SS" (or "M:SS" under an hour). */
export function formatDuration(total: number): string {
  const t = Math.round(Number(total))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

/** Display a typed-entry value in the question's format. */
export function formatEntry(q: Question, value: number): string {
  return q.entry_format === 'duration' ? formatDuration(value) : String(value)
}
