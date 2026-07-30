import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { entryWinners, formatEntry, isScored, parseDuration, scoreForUser } from '../lib/score'
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

  const myRows = useMemo(
    () => new Map(picks.filter((p) => p.user_id === userId).map((p) => [p.question_id, p])),
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
      return [
        ...others,
        { id: 'tmp-' + questionId, user_id: userId, question_id: questionId, option_id: optionId, entry_value: null },
      ]
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

  async function saveEntry(questionId: string, value: number) {
    if (!event || event.status !== 'open') return
    setSaving(questionId)
    setError(null)
    const { error } = await supabase
      .from('picks')
      .upsert(
        { user_id: userId, question_id: questionId, entry_value: value, option_id: null },
        { onConflict: 'user_id,question_id' },
      )
    if (error) {
      setError('Could not save that answer — the card may have just been locked. Refresh to check.')
    } else {
      setPicks((cur) => {
        const others = cur.filter((p) => !(p.user_id === userId && p.question_id === questionId))
        return [
          ...others,
          { id: 'tmp-' + questionId, user_id: userId, question_id: questionId, option_id: null, entry_value: value },
        ]
      })
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
  const pickedCount = questions.filter((q) => myRows.has(q.id)).length
  const scoredCount = questions.filter(isScored).length

  const eventScores =
    revealAll && scoredCount > 0
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

      {eventScores.length > 0 && (
        <section className="card score-summary">
          <h2 className="section-title">
            {isFinal ? 'Event Results' : '🔴 Live Scoreboard'}
          </h2>
          {!isFinal && (
            <p className="muted">
              {scoredCount} of {questions.length} results in — scores update as the commissioner
              enters each finish. Refresh for the latest.
            </p>
          )}
          <ol className="score-list">
            {eventScores.map((s, i) => (
              <li key={s.profile.id} className={s.profile.id === userId ? 'me' : ''}>
                <span className="rank">{isFinal && i === 0 ? '🏆' : i + 1}</span>
                <span className="name">{s.profile.display_name}</span>
                <span className="pts">{s.score} pts</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="question-list">
        {questions.map((q, idx) => {
          const myRow = myRows.get(q.id)
          const mine = myRow?.option_id ?? null
          return (
            <div key={q.id} className={`card question-card ${q.kind}`}>
              <div className="question-head">
                <span className="question-kind">
                  {q.kind === 'match'
                    ? `Match ${questions.filter((x) => x.kind === 'match').indexOf(q) + 1}`
                    : q.kind === 'entry'
                      ? 'Closest Without Going Over'
                      : 'Prop Bet'}
                </span>
                <span className="question-points">{q.points} {q.points === 1 ? 'pt' : 'pts'}</span>
              </div>
              <h3 className="question-title">{q.title}</h3>
              {q.detail && <div className="question-detail">{q.detail}</div>}

              {q.kind === 'entry' ? (
                <EntryQuestion
                  q={q}
                  myRow={myRow}
                  isOpen={isOpen}
                  revealAll={revealAll}
                  picks={picks}
                  nameOf={nameOf}
                  saving={saving === q.id}
                  onSave={(v) => saveEntry(q.id, v)}
                />
              ) : (
                <>
                  <div className="option-row">
                    {q.options.map((o) => {
                      const isMine = mine === o.id
                      const isCorrect = q.correct_option_id === o.id
                      const cls = [
                        'option-btn',
                        isMine ? 'selected' : '',
                        revealAll && isCorrect ? 'correct' : '',
                        revealAll && isMine && !isCorrect && q.correct_option_id ? 'wrong' : '',
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
                          {revealAll && isCorrect && <span className="tag-win">WINNER</span>}
                        </button>
                      )
                    })}
                  </div>

                  {revealAll && mine && q.correct_option_id && (
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
                </>
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

function EntryQuestion({
  q,
  myRow,
  isOpen,
  revealAll,
  picks,
  nameOf,
  saving,
  onSave,
}: {
  q: Question
  myRow: Pick | undefined
  isOpen: boolean
  revealAll: boolean
  picks: Pick[]
  nameOf: (uid: string) => string
  saving: boolean
  onSave: (value: number) => void
}) {
  const { session } = useAuth()
  const userId = session!.user.id
  const isDuration = q.entry_format === 'duration'
  const myValue = myRow?.entry_value != null ? Number(myRow.entry_value) : null
  const [text, setText] = useState(myValue != null ? formatEntry(q, myValue) : '')
  const [parseError, setParseError] = useState(false)

  const winners = q.answer_value != null ? entryWinners(q, picks) : []
  const allEntries = picks
    .filter((p) => p.question_id === q.id && p.entry_value != null)
    .sort((a, b) => Number(b.entry_value) - Number(a.entry_value))

  function submit() {
    const v = isDuration ? parseDuration(text) : Number.isFinite(Number(text.trim())) && text.trim() !== '' ? Number(text.trim()) : null
    if (v == null || v < 0) {
      setParseError(true)
      return
    }
    setParseError(false)
    onSave(v)
  }

  return (
    <div className="entry-block">
      {isOpen && (
        <div className="entry-form">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={isDuration ? 'H:MM:SS' : 'Enter a number'}
            inputMode={isDuration ? 'numeric' : 'decimal'}
          />
          <button className="btn btn-secondary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : myValue != null ? 'Update' : 'Save'}
          </button>
        </div>
      )}
      {parseError && (
        <div className="alert alert-error">
          {isDuration ? 'Enter a time like 6:45:30 (hours:minutes:seconds).' : 'Enter a valid number.'}
        </div>
      )}
      {myValue != null && (
        <div className="entry-mine">
          Your answer: <strong>{formatEntry(q, myValue)}</strong>
        </div>
      )}

      {q.answer_value != null && revealAll && (
        <div className="result-line hit">
          Actual: {formatEntry(q, Number(q.answer_value))}
          {winners.length > 0
            ? ` — ${winners.map(nameOf).join(' & ')} win${winners.length === 1 ? 's' : ''} (+${q.points})`
            : ' — everyone went over, no points awarded'}
        </div>
      )}

      {revealAll && allEntries.length > 0 && (
        <details className="everyones-picks" open={q.answer_value != null}>
          <summary>Everyone’s answers</summary>
          <ul>
            {allEntries.map((p) => (
              <li key={p.id} className={winners.includes(p.user_id) ? 'entry-winner' : ''}>
                <strong>{nameOf(p.user_id)}:</strong> {formatEntry(q, Number(p.entry_value))}
                {winners.includes(p.user_id) && ' 🏆'}
                {p.user_id === userId && ' (you)'}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
