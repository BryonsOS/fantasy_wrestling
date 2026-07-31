export type EventStatus = 'draft' | 'open' | 'locked' | 'final'

export interface Profile {
  id: string
  display_name: string
  is_admin: boolean
}

export interface LeagueEvent {
  id: string
  name: string
  promotion: string | null
  event_date: string | null
  status: EventStatus
  is_finale: boolean
}

export type QuestionKind = 'match' | 'prop' | 'entry'

export type EntryFormat = 'duration' | 'number' | 'text'

export interface Option {
  id: string
  question_id: string
  label: string
  sort_order: number
}

export interface Question {
  id: string
  event_id: string
  kind: QuestionKind
  title: string
  detail: string | null
  points: number
  sort_order: number
  correct_option_id: string | null
  entry_format: EntryFormat | null
  answer_value: number | null
  answer_text: string | null
  options: Option[]
}

export interface Pick {
  id: string
  user_id: string
  question_id: string
  option_id: string | null
  entry_value: number | null
  entry_text: string | null
  is_correct: boolean | null
}

export const STATUS_LABELS: Record<EventStatus, string> = {
  draft: 'Draft',
  open: 'Picks Open',
  locked: 'Locked',
  final: 'Final',
}
