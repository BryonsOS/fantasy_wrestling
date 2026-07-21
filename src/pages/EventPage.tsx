import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { scoreForUser } from '../lib/score'
import {
  STATUS_LABELS,
  type LeagueEvent,
  type Pick,
  type Profile,
  type Question,
} from '../lib/types'

export default function EventPage() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const userId = session!.user.id

  const [event, setEvent] = useState<LeagueEvent | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [picks, setPicks] = useState<Pick[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (!id) return
    const [evRes, qRes, pickRes, profRes] = await Promise.all([
      supabase.from('events').select('*').eq('id', id).single(),
      supabase
        .from('questions')
        .select('*, options!question_id(*)')
        .eq('event_id', id)
        .order('sort_order')
        .order('created_at')
        .order('sort_order', { referencedTable: 'options' }),
      supabase.from('picks').select('*, questions!inner(event_id)').eq('questions.event_id', id),
      supabase.from('profiles').select('*'),
    ])
    setEvent(evRes.data as LeagueEvent | null)
    setQuestions((qRes.data as Question[]) ?? [])
    setPicks(((pickRes.data as (Pick & { questions: unknown })[]) ?? []).map(
      ({ questions: _q, ...p }) => p as Pick,
    ))
    setProfiles((profRes.data as Profile[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    setLoading(true)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const myPicks = useMemo(
    () => new Map(picks.filter((p) => p.user_id === userId).map((p) => [p.question_id, p.option_id])),
    [picks, userId],
  )

  async function choose(questionId: string, optionId: string) {
    if (!event || event.status !== 'open') return
    setSaving(questionId)
    setError(null)
    const prev = picks
    // optimistic update
    setPicks((cur) => {
      const others = cur.filter((p) => !(p.user_id === userId && p.question_id === questionId))
      return [...others, { id: 'tmp-' + questionId, user_id: userId, question_id: questionId, option_id: optionId }]
    })
    const { error } = await supabase
      .from('picks')
      .upsert(
        { user_id: userId, question_id: questionId, option_id: optionId },
        { onConflict: 'user_id,question_id' },
      )
    if (error) {
      setPicks(prev)
      setError('Could not save that pick — the card may have just been locked. Refresh to check.')
    }
    setSaving(null)
  }

  if (loading) return <div className="page-loading">Loading card…</div>
  if (!event)
    return (
      <div className="page">
        <p>Event not found.</p>
        <Link to="/">← Back to events</Link>
      </div>
    )

  const isOpen = event.status === 'open'
  const revealAll = event.status === 'locked' || event.status === 'final'
  const isFinal = event.status === 'final'
  const pickedCount = questions.filter((q) => myPicks.has(q.id)).length

  const eventScores = isFinal
    ? profiles
        .map((pr) => ({ profile: pr, score: scoreForUser(pr.id, questions, picks) }))
        .filter((s) => picks.some((p) => p.user_id === s.profile.id))
        .sort((a, b) => b.score - a.score)
    : []

  const nameOf = (uid: string) => profiles.find((p) => p.id === uid)?.display_name ?? '—'

  return (
    <div className="page">
      <Link to="/" className="back-link">
        ← All events
      </Link>
      <div className="event-header">
        <div>
          {event.promotion && <div className="event-promotion">{event.promotion}</div>}
          <h1 className="page-title">{event.name}</h1>
          {event.event_date && (
            <div className="event-date">
              {new Date(event.event_date + 'T00:00:00').toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </div>
          )}
        </div>
        <span className={`badge badge-lg badge-${event.status}`}>{STATUS_LABELS[event.status]}</span>
      </div>

      {isOpen && (
        <div className="pick-progress">
          <div className="pick-progress-bar">
            <div
              className="pick-progress-fill"
              style={{ width: questions.length ? `${(pickedCount / questions.length) * 100}%` : 0 }}
            />
          </div>
          <span>
            {pickedCount}/{questions.length} picks made — picks save automatically
          </span>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {isFinal && eventScores.length > 0 && (
        <section className="card score-summary">
          <h2 className="section-title">Event Results</h2>
          <ol className="score-list">
            {eventScores.map((s, i) => (
              <li key={s.profile.id} className={s.profile.id === userId ? 'me' : ''}>
                <span className="rank">{i + 1}</span>
                <span className="name">{s.profile.display_name}</span>
                <span className="pts">{s.score} pts</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="question-list">
        {questions.map((q, idx) => {
          const mine = myPicks.get(q.id)
          return (
            <div key={q.id} className={`card question-card ${q.kind}`}>
              <div className="question-head">
                <span className="question-kind">{q.kind === 'match' ? `Match ${questions.filter((x) => x.kind === 'match').indexOf(q) + 1}` : 'Prop Bet'}</span>
                <span className="question-points">{q.points} {q.points === 1 ? 'pt' : 'pts'}</span>
              </div>
              <h3 className="question-title">{q.title}</h3>
              {q.detail && <div className="question-detail">{q.detail}</div>}

              <div className="option-row">
                {q.options.map((o) => {
                  const isMine = mine === o.id
                  const isCorrect = q.correct_option_id === o.id
                  const cls = [
                    'option-btn',
                    isMine ? 'selected' : '',
                    isFinal && isCorrect ? 'correct' : '',
                    isFinal && isMine && !isCorrect && q.correct_option_id ? 'wrong' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')
                  return (
                    <button
                      key={o.id}
                      className={cls}
                      disabled={!isOpen || saving === q.id}
                      onClick={() => choose(q.id, o.id)}
                    >
                      {o.label}
                      {isFinal && isCorrect && <span className="tag-win">WINNER</span>}
                    </button>
                  )
                })}
              </div>

              {isFinal && mine && q.correct_option_id && (
                <div className={mine === q.correct_option_id ? 'result-line hit' : 'result-line miss'}>
                  {mine === q.correct_option_id ? `✔ Nailed it (+${q.points})` : '✘ Missed'}
                </div>
              )}

              {revealAll && (
                <details className="everyones-picks">
                  <summary>Everyone’s picks</summary>
                  <ul>
                    {q.options.map((o) => {
                      const who = picks
                        .filter((p) => p.question_id === q.id && p.option_id === o.id)
                        .map((p) => nameOf(p.user_id))
                      if (who.length === 0) return null
                      return (
                        <li key={o.id}>
                          <strong>{o.label}:</strong> {who.join(', ')}
                        </li>
                      )
                    })}
                  </ul>
                </details>
              )}
              <span className="question-index">#{idx + 1}</span>
            </div>
          )
        })}
      </div>

      {questions.length === 0 && (
        <div className="empty-state">
          <p>The card hasn’t been posted for this event yet.</p>
        </div>
      )}
    </div>
  )
}
