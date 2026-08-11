import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { LiveDot } from '../components/icons'
import { entryWinners, formatDuration, formatEntry, isScored, parseDuration, scoreForUser } from '../lib/score'
import { countdownText } from '../lib/time'
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

  // Live updates: reload when results, picks, or event status change.
  useEffect(() => {
    if (!id) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const reload = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => load(), 400)
    }
    const channel = supabase
      .channel(`event-live-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `id=eq.${id}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'questions', filter: `event_id=eq.${id}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'picks' }, reload)
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // ticks once a minute so the lock countdown stays current
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

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
        {
          id: 'tmp-' + questionId,
          user_id: userId,
          question_id: questionId,
          option_id: optionId,
          entry_value: null,
          entry_text: null,
          is_correct: null,
        },
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

  async function saveEntry(questionId: string, entry: { entry_value?: number; entry_text?: string }) {
    if (!event || event.status !== 'open') return
    setSaving(questionId)
    setError(null)
    const row = {
      user_id: userId,
      question_id: questionId,
      option_id: null,
      entry_value: entry.entry_value ?? null,
      entry_text: entry.entry_text ?? null,
    }
    const { error } = await supabase
      .from('picks')
      .upsert(row, { onConflict: 'user_id,question_id' })
    if (error) {
      setError('Could not save that answer — the card may have just been locked. Refresh to check.')
    } else {
      setPicks((cur) => {
        const others = cur.filter((p) => !(p.user_id === userId && p.question_id === questionId))
        return [...others, { id: 'tmp-' + questionId, is_correct: null, ...row }]
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

  const matchQuestions = questions.filter((q) => q.kind === 'match')
  function kickerFor(q: Question): string {
    if (q.kind === 'prop') return 'Prop Bet'
    if (q.kind === 'entry') {
      if (q.points === 0) return 'Tiebreaker'
      return q.entry_format === 'text' ? 'Fill-In' : 'Closest Without Going Over'
    }
    const n = matchQuestions.indexOf(q)
    if (n === 0) return 'Main Event'
    if (/championship/i.test(q.title)) return 'Championship Match'
    return `Match ${n + 1}`
  }

  function DetailLine({ detail }: { detail: string }) {
    const parts = detail.split(/ vs\.? /i)
    if (parts.length < 2) return <div className="question-detail">{detail}</div>
    return (
      <div className="question-detail">
        {parts.map((part, i) => (
          <span key={i}>
            {i > 0 && <span className="vs">VS</span>}
            {part}
          </span>
        ))}
      </div>
    )
  }

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

      {isOpen && event.locks_at && (
        <div className="lock-countdown">{countdownText(event.locks_at, now)}</div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {eventScores.length > 0 && (
        <section className="card score-summary">
          <h2 className="section-title">
            {isFinal ? 'Event Results' : (<><LiveDot />Live Scoreboard</>)}
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
                <span className={isFinal && i === 0 ? 'rank rank-champ' : 'rank'}>{i + 1}</span>
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
          const isMainEvent = q.kind === 'match' && matchQuestions.indexOf(q) === 0
          return (
            <div key={q.id} className={`card question-card ${q.kind}${isMainEvent ? ' main-event' : ''}`}>
              <div className="question-head">
                <span className="question-kind">{kickerFor(q)}</span>
                <span className="question-points">
                  {q.points === 0 ? 'Tiebreaker' : `${q.points} ${q.points === 1 ? 'pt' : 'pts'}`}
                </span>
              </div>
              <h3 className="question-title">{q.title}</h3>
              {q.detail && <DetailLine detail={q.detail} />}

              {q.kind === 'entry' ? (
                <EntryQuestion
                  q={q}
                  myRow={myRow}
                  isOpen={isOpen}
                  revealAll={revealAll}
                  picks={picks}
                  nameOf={nameOf}
                  saving={saving === q.id}
                  onSave={(entry) => saveEntry(q.id, entry)}
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
                      {mine === q.correct_option_id ? `HIT +${q.points}` : 'MISS'}
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
  onSave: (entry: { entry_value?: number; entry_text?: string }) => void
}) {
  const { session } = useAuth()
  const userId = session!.user.id
  const isDuration = q.entry_format === 'duration'
  const isText = q.entry_format === 'text'
  const myValue = myRow?.entry_value != null ? Number(myRow.entry_value) : null
  const myText = myRow?.entry_text ?? null
  const [text, setText] = useState(isText ? (myText ?? '') : myValue != null ? formatEntry(q, myValue) : '')
  const [parseError, setParseError] = useState(false)

  const scored = isText ? q.answer_text != null : q.answer_value != null
  const winners = scored ? entryWinners(q, picks) : []
  const allEntries = picks
    .filter((p) => p.question_id === q.id && (isText ? p.entry_text != null : p.entry_value != null))
    .sort((a, b) => (isText ? 0 : Number(b.entry_value) - Number(a.entry_value)))

  const haveAnswer = isText ? myText != null : myValue != null

  // live "we read this as..." preview for duration input
  const durationPreview =
    isDuration && text.trim() !== '' ? parseDuration(text) : null

  function submit() {
    if (isText) {
      const v = text.trim()
      if (!v) {
        setParseError(true)
        return
      }
      setParseError(false)
      onSave({ entry_text: v })
      return
    }
    const v = isDuration
      ? parseDuration(text)
      : Number.isFinite(Number(text.trim())) && text.trim() !== '' ? Number(text.trim()) : null
    if (v == null || v < 0) {
      setParseError(true)
      return
    }
    setParseError(false)
    onSave({ entry_value: v })
  }

  return (
    <div className="entry-block">
      {isOpen && (
        <div className="entry-form">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={isText ? 'Type your guess' : isDuration ? 'H:MM:SS' : 'Enter a number'}
            inputMode={isText ? 'text' : isDuration ? 'numeric' : 'decimal'}
            maxLength={isText ? 100 : undefined}
          />
          <button className="btn btn-secondary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : haveAnswer ? 'Update' : 'Save'}
          </button>
        </div>
      )}
      {isOpen && durationPreview != null && (
        <div className="entry-preview">
          Reads as <strong>{formatDuration(durationPreview)}</strong>
          {durationPreview >= 3600 &&
            ` (${Math.floor(durationPreview / 3600)}h ${Math.floor((durationPreview % 3600) / 60)}m ${durationPreview % 60}s)`}
        </div>
      )}
      {isOpen && isDuration && text.trim() !== '' && durationPreview == null && (
        <div className="entry-preview bad">Can’t read that — try 5:26:54</div>
      )}
      {parseError && (
        <div className="alert alert-error">
          {isText
            ? 'Type an answer first.'
            : isDuration
              ? 'Enter a time like 5:26:54 (hours:minutes:seconds).'
              : 'Enter a valid number.'}
        </div>
      )}
      {haveAnswer && (
        <div className="entry-mine">
          Your answer: <strong>{isText ? myText : formatEntry(q, myValue!)}</strong>
          {revealAll && isText && myRow?.is_correct === true && <span className="tag-win">CORRECT</span>}
        </div>
      )}

      {scored && revealAll && (
        <div className="result-line hit">
          Actual: {isText ? q.answer_text : formatEntry(q, Number(q.answer_value))}
          {winners.length > 0
            ? ` — ${[...new Set(winners)].map(nameOf).join(' & ')} win${winners.length === 1 ? 's' : ''} (+${q.points})`
            : isText
              ? ' — nobody called it'
              : ' — everyone went over, no points awarded'}
        </div>
      )}

      {revealAll && allEntries.length > 0 && (
        <details className="everyones-picks" open={scored}>
          <summary>Everyone’s answers</summary>
          <ul>
            {allEntries.map((p) => (
              <li key={p.id} className={winners.includes(p.user_id) ? 'entry-winner' : ''}>
                <strong>{nameOf(p.user_id)}:</strong>{' '}
                {isText ? p.entry_text : formatEntry(q, Number(p.entry_value))}
                {winners.includes(p.user_id) && <span className="tag-win">WINNER</span>}
                {p.user_id === userId && ' (you)'}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
