import type { Pick, Question } from './types'

/**
 * Winners of a typed-entry question.
 * - text: whoever the admin marked correct.
 * - number/duration: Price Is Right rules — closest to the actual value
 *   WITHOUT going over. Ties all win. Nobody under -> nobody wins.
 */
export function entryWinners(q: Question, picks: Pick[]): string[] {
  if (q.entry_format === 'text') {
    return picks.filter((p) => p.question_id === q.id && p.is_correct === true).map((p) => p.user_id)
  }
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
  if (q.kind !== 'entry') return q.correct_option_id != null
  return q.entry_format === 'text' ? q.answer_text != null : q.answer_value != null
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

/**
 * Parse a duration into total seconds. Null if invalid.
 * With colons: "H:MM:SS" or "MM:SS".
 * Without colons, digits are read clock-style from the right:
 * "52654" -> 5:26:54, "2654" -> 26:54, "130" -> 1:30, "45" -> 0:45.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim()
  if (!s) return null

  if (s.includes(':')) {
    const parts = s.split(':').map((p) => p.trim())
    if (parts.length > 3 || parts.some((p) => p === '' || !/^\d+$/.test(p))) return null
    // minutes/seconds segments must be 0-59
    for (let i = 1; i < parts.length; i++) {
      if (parseInt(parts[i], 10) >= 60) return null
    }
    let secs = 0
    for (const p of parts) secs = secs * 60 + parseInt(p, 10)
    return secs
  }

  if (!/^\d+$/.test(s)) return null
  if (s.length <= 2) return parseInt(s, 10) // just seconds
  const sec = parseInt(s.slice(-2), 10)
  const min = parseInt(s.slice(-4, -2), 10)
  const hr = s.length > 4 ? parseInt(s.slice(0, -4), 10) : 0
  if (sec >= 60 || min >= 60) return null
  return hr * 3600 + min * 60 + sec
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
