import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatEntry, isScored, parseDuration } from '../lib/score'
import {
  STATUS_LABELS,
  type EntryFormat,
  type EventStatus,
  type LeagueEvent,
  type Question,
  type QuestionKind,
} from '../lib/types'

const STATUS_FLOW: { status: EventStatus; hint: string }[] = [
  { status: 'draft', hint: 'Hidden from members while you build the card.' },
  { status: 'open', hint: 'Members can see the card and make picks.' },
  { status: 'locked', hint: 'Picks frozen — bell time. Everyone’s picks are revealed.' },
  { status: 'final', hint: 'Results are in and points count toward standings.' },
]

export default function AdminEventPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [event, setEvent] = useState<LeagueEvent | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [error, setError] = useState<string | null>(null)

  // new question form
  const [kind, setKind] = useState<QuestionKind>('match')
  const [entryFormat, setEntryFormat] = useState<EntryFormat>('duration')
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [points, setPoints] = useState(1)
  const [optionsText, setOptionsText] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    if (!id) return
    const [evRes, qRes] = await Promise.all([
      supabase.from('events').select('*').eq('id', id).single(),
      supabase
        .from('questions')
        .select('*, options!question_id(*)')
        .eq('event_id', id)
        .order('sort_order')
        .order('created_at')
        .order('sort_order', { referencedTable: 'options' }),
    ])
    setEvent(evRes.data as LeagueEvent | null)
    setQuestions((qRes.data as Question[]) ?? [])
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function setStatus(status: EventStatus) {
    if (!event) return
    if (status === 'final') {
      const unscored = questions.filter((q) => !isScored(q))
      if (unscored.length > 0 && !confirm(`${unscored.length} pick(s) have no result entered — they'll score 0 for everyone. Go final anyway?`)) {
        return
      }
    }
    const { error } = await supabase.from('events').update({ status }).eq('id', event.id)
    if (error) setError(error.message)
    else setEvent({ ...event, status })
  }

  async function saveEventField(fields: Partial<LeagueEvent>) {
    if (!event) return
    const { error } = await supabase.from('events').update(fields).eq('id', event.id)
    if (error) setError(error.message)
  }

  async function deleteEvent() {
    if (!event) return
    if (!confirm(`Delete "${event.name}" and all its picks? This can't be undone.`)) return
    const { error } = await supabase.from('events').delete().eq('id', event.id)
    if (error) setError(error.message)
    else navigate('/admin')
  }

  async function addQuestion(e: FormEvent) {
    e.preventDefault()
    if (!event) return
    const labels = optionsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (kind !== 'entry' && labels.length < 2) {
      setError('Enter at least two options (one per line).')
      return
    }
    setBusy(true)
    setError(null)
    const { data: q, error: qErr } = await supabase
      .from('questions')
      .insert({
        event_id: event.id,
        kind,
        title: title.trim(),
        detail: detail.trim() || null,
        points,
        sort_order: questions.length,
        entry_format: kind === 'entry' ? entryFormat : null,
      })
      .select()
      .single()
    if (qErr || !q) {
      setError(qErr?.message ?? 'Failed to add')
      setBusy(false)
      return
    }
    if (kind !== 'entry') {
      const { error: oErr } = await supabase
        .from('options')
        .insert(labels.map((label, i) => ({ question_id: q.id, label, sort_order: i })))
      if (oErr) setError(oErr.message)
    }
    setTitle('')
    setDetail('')
    setOptionsText('')
    setPoints(kind === 'prop' ? 2 : 1)
    await load()
    setBusy(false)
  }

  async function saveEntryAnswer(qid: string, raw: string, format: EntryFormat | null) {
    const trimmed = raw.trim()
    let value: number | null = null
    if (trimmed !== '') {
      value = format === 'duration' ? parseDuration(trimmed) : Number.isFinite(Number(trimmed)) ? Number(trimmed) : null
      if (value == null) {
        setError(format === 'duration' ? 'Result must be a time like 6:45:30.' : 'Result must be a number.')
        return
      }
    }
    const { error } = await supabase.from('questions').update({ answer_value: value }).eq('id', qid)
    if (error) setError(error.message)
    else {
      setError(null)
      setQuestions((qs) => qs.map((q) => (q.id === qid ? { ...q, answer_value: value } : q)))
    }
  }

  async function deleteQuestion(qid: string) {
    if (!confirm('Delete this pick and any member picks on it?')) return
    const { error } = await supabase.from('questions').delete().eq('id', qid)
    if (error) setError(error.message)
    else await load()
  }

  async function setCorrect(qid: string, optionId: string | null) {
    const { error } = await supabase
      .from('questions')
      .update({ correct_option_id: optionId })
      .eq('id', qid)
    if (error) setError(error.message)
    else
      setQuestions((qs) =>
        qs.map((q) => (q.id === qid ? { ...q, correct_option_id: optionId } : q)),
      )
  }

  async function updatePoints(qid: string, pts: number) {
    if (!Number.isFinite(pts) || pts < 1) return
    const { error } = await supabase.from('questions').update({ points: pts }).eq('id', qid)
    if (error) setError(error.message)
    else setQuestions((qs) => qs.map((q) => (q.id === qid ? { ...q, points: pts } : q)))
  }

  if (!event) return <div className="page-loading">Loading…</div>

  return (
    <div className="page">
      <Link to="/admin" className="back-link">
        ← Commissioner’s Office
      </Link>
      <div className="event-header">
        <h1 className="page-title">{event.name}</h1>
        <span className={`badge badge-lg badge-${event.status}`}>{STATUS_LABELS[event.status]}</span>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="card admin-section">
        <h2 className="section-title">Event Status</h2>
        <div className="status-flow">
          {STATUS_FLOW.map((s) => (
            <button
              key={s.status}
              className={`status-step ${event.status === s.status ? 'active' : ''}`}
              onClick={() => setStatus(s.status)}
              title={s.hint}
            >
              {STATUS_LABELS[s.status]}
            </button>
          ))}
        </div>
        <p className="muted">{STATUS_FLOW.find((s) => s.status === event.status)?.hint}</p>
      </section>

      <section className="card admin-section">
        <h2 className="section-title">Event Details</h2>
        <div className="admin-form">
          <label>
            Name
            <input
              defaultValue={event.name}
              onBlur={(e) => saveEventField({ name: e.target.value.trim() || event.name })}
            />
          </label>
          <label>
            Promotion
            <input
              defaultValue={event.promotion ?? ''}
              onBlur={(e) => saveEventField({ promotion: e.target.value.trim() || null })}
            />
          </label>
          <label>
            Date
            <input
              type="date"
              defaultValue={event.event_date ?? ''}
              onBlur={(e) => saveEventField({ event_date: e.target.value || null })}
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              defaultChecked={event.is_finale}
              onChange={(e) => {
                saveEventField({ is_finale: e.target.checked })
                setEvent({ ...event, is_finale: e.target.checked })
              }}
            />
            <span>
              Season finale — when this event goes <strong>Final</strong>, the standings leader is
              crowned Ultimate Champion 🏆
            </span>
          </label>
        </div>
      </section>

      <section className="card admin-section">
        <h2 className="section-title">The Card ({questions.length})</h2>
        {questions.length === 0 && <p className="muted">No matches or props yet — add them below.</p>}
        <div className="admin-question-list">
          {questions.map((q) => (
            <div key={q.id} className="admin-question">
              <div className="admin-question-head">
                <span className={`chip chip-${q.kind}`}>
                  {q.kind === 'match' ? 'Match' : q.kind === 'entry' ? 'Typed Entry' : 'Prop'}
                </span>
                <strong>{q.title}</strong>
                <span className="spacer" />
                <label className="points-input">
                  <input
                    type="number"
                    min={1}
                    defaultValue={q.points}
                    onBlur={(e) => updatePoints(q.id, parseInt(e.target.value, 10))}
                  />{' '}
                  pts
                </label>
                <button className="btn btn-ghost btn-sm danger" onClick={() => deleteQuestion(q.id)}>
                  Delete
                </button>
              </div>
              {q.detail && <div className="muted">{q.detail}</div>}
              {q.kind === 'entry' ? (
                <div className="admin-options">
                  <span className="muted">
                    Actual result ({q.entry_format === 'duration' ? 'H:MM:SS' : 'number'}):
                  </span>
                  <input
                    className="entry-answer-input"
                    defaultValue={q.answer_value != null ? formatEntry(q, Number(q.answer_value)) : ''}
                    placeholder={q.entry_format === 'duration' ? 'e.g. 6:45:30' : 'e.g. 42'}
                    onBlur={(e) => saveEntryAnswer(q.id, e.target.value, q.entry_format)}
                  />
                  {q.answer_value != null && <span className="muted">✔ saved — clear the box to unset</span>}
                </div>
              ) : (
                <div className="admin-options">
                  <span className="muted">Result:</span>
                  {q.options.map((o) => (
                    <button
                      key={o.id}
                      className={`option-btn sm ${q.correct_option_id === o.id ? 'correct' : ''}`}
                      onClick={() => setCorrect(q.id, q.correct_option_id === o.id ? null : o.id)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card admin-section">
        <h2 className="section-title">Add to the Card</h2>
        <form onSubmit={addQuestion} className="admin-form">
          <label>
            Type
            <select value={kind} onChange={(e) => setKind(e.target.value as QuestionKind)}>
              <option value="match">Match (pick the winner)</option>
              <option value="prop">Prop bet</option>
              <option value="entry">Typed entry (closest without going over)</option>
            </select>
          </label>
          {kind === 'entry' && (
            <label>
              Answer format
              <select value={entryFormat} onChange={(e) => setEntryFormat(e.target.value as EntryFormat)}>
                <option value="duration">Time (H:MM:SS)</option>
                <option value="number">Number</option>
              </select>
            </label>
          )}
          <label>
            {kind === 'match' ? 'Match title' : kind === 'entry' ? 'Question' : 'Prop question'}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                kind === 'match'
                  ? 'e.g. World Heavyweight Championship'
                  : kind === 'entry'
                    ? 'e.g. How long will the main event last?'
                    : 'e.g. Will anyone bleed in the main event?'
              }
              required
            />
          </label>
          <label>
            Detail (optional)
            <input
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder={kind === 'match' ? 'e.g. Steel Cage — Rollins (c) vs. Punk' : 'Any clarifying rules'}
            />
          </label>
          {kind !== 'entry' && (
            <label>
              Options (one per line)
              <textarea
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                rows={4}
                placeholder={kind === 'match' ? 'Seth Rollins\nCM Punk' : 'Yes\nNo'}
                required
              />
            </label>
          )}
          {kind === 'entry' && (
            <p className="muted">
              Members type their answer. Closest without going over wins the points (ties all win;
              if everyone goes over, no one scores).
            </p>
          )}
          <label>
            Points for a correct pick
            <input
              type="number"
              min={1}
              value={points}
              onChange={(e) => setPoints(parseInt(e.target.value, 10) || 1)}
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            Add to Card
          </button>
        </form>
      </section>

      <section className="card admin-section danger-zone">
        <h2 className="section-title">Danger Zone</h2>
        <button className="btn btn-danger" onClick={deleteEvent}>
          Delete this event
        </button>
      </section>
    </div>
  )
}
