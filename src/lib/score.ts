import type { Pick, Question } from './types'

/** Points a user earned across a set of scored questions. */
export function scoreForUser(userId: string, questions: Question[], picks: Pick[]): number {
  let total = 0
  for (const q of questions) {
    if (!q.correct_option_id) continue
    const pick = picks.find((p) => p.user_id === userId && p.question_id === q.id)
    if (pick && pick.option_id === q.correct_option_id) total += q.points
  }
  return total
}

/** Max points available on a set of questions (only ones with a result entered). */
export function pointsAvailable(questions: Question[]): number {
  return questions.filter((q) => q.correct_option_id).reduce((s, q) => s + q.points, 0)
}
