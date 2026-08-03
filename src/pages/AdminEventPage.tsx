import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatEntry, isScored, parseDuration } from '../lib/score'
import {
  STATUS_LABELS,
  type EntryFormat,
  type EventStatus,
  type LeagueEvent,
  type Pick,
  type Profile,
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
  const [picks, setPicks] = useState<Pick[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // browser confirm() dialogs get silently blocked by some mobile browsers,
  // so destructive actions arm on first tap and fire on the second
  const [armed, setArmed] = useState<string | null>(null)

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
  }

  const nameOf = (uid: string) => profiles.find((p) => p.id === uid)?.display_name ?? '—'

  async function markTextPick(pickId: string, correct: boolean | null) {
    const current = picks.find((p) => p.id === pickId)
    if (!current) return
    const target = current.is_correct === correct ? null : correct
    const { error } = await supabase.rpc('score_text_pick', { p_pick_id: pickId, p_correct: target })
    if (error) setError(error.message)
    else setPicks((cur) => cur.map((p) => (p.id === pickId ? { ...p, is_correct: target } : p)))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function setStatus(status: EventStatus) {
    if (!event) return
    if (status === 'final' && armed !== 'final') {
      const unscored = questions.filter((q) => !isScored(q))
      if (unscored.length > 0) {
        setArmed('final')
        setNotice(
          `${unscored.length} pick(s) have no result entered — they'll score 0 for everyone. Tap Final again to confirm.`,
        )
        return
      }
    }
    setArmed(null)
    setNotice(null)
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
    if (armed !== 'delete-event') {
      setArmed('delete-event')
      setNotice(`This deletes "${event.name}" and every pick on it, permanently. Tap the button again to confirm.`)
      return
    }
    setArmed(null)
    setNotice(null)
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

    if (format === 'text') {
      const value = trimmed || null
      const { error } = await supabase.from('questions').update({ answer_text: value }).eq('id', qid)
      if (error) {
        setError(error.message)
        return
      }
      setError(null)
      setQuestions((qs) => qs.map((q) => (q.id === qid ? { ...q, answer_text: value } : q)))
      // Pre-mark exact matches (case/space-insensitive); commissioner can toggle any of them.
      if (value) {
        const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
        const rows = picks.filter((p) => p.question_id === qid && p.entry_text != null)
        for (const p of rows) {
          const correct = norm(p.entry_text!) === norm(value)
          await supabase.rpc('score_text_pick', { p_pick_id: p.id, p_correct: correct })
        }
        setPicks((cur) =>
          cur.map((p) =>
            p.question_id === qid && p.entry_text != null
              ? { ...p, is_correct: norm(p.entry_text) === norm(value) }
              : p,
          ),
        )
      }
      return
    }

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
    if (armed !== 'delete-q-' + qid) {
      setArmed('delete-q-' + qid)
      return
    }
    setArmed(null)
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
    if (!Number.isFinite(pts) || pts < 0) return
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
      {notice && <div className="alert alert-error">{notice}</div>}

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
                    min={0}
                    defaultValue={q.points}
                    onBlur={(e) => updatePoints(q.id, parseInt(e.target.value, 10))}
                  />{' '}
                  pts
                </label>
                <button className="btn btn-ghost btn-sm danger" onClick={() => deleteQuestion(q.id)}>
                  {armed === 'delete-q-' + q.id ? 'Tap again to delete' : 'Delete'}
                </button>
              </div>
              {q.detail && <div className="muted">{q.detail}</div>}
              {q.kind === 'entry' ? (
                <>
                  <div className="admin-options">
                    <span className="muted">
                      Actual result ({q.entry_format === 'duration' ? 'H:MM:SS' : q.entry_format === 'text' ? 'text' : 'number'}):
                    </span>
                    <input
                      className={q.entry_format === 'text' ? 'entry-answer-input wide' : 'entry-answer-input'}
                      defaultValue={
                        q.entry_format === 'text'
                          ? q.answer_text ?? ''
                          : q.answer_value != null ? formatEntry(q, Number(q.answer_value)) : ''
                      }
                      placeholder={q.entry_format === 'duration' ? 'e.g. 6:45:30' : q.entry_format === 'text' ? 'e.g. Becky Lynch' : 'e.g. 42'}
                      onBlur={(e) => saveEntryAnswer(q.id, e.target.value, q.entry_format)}
                    />
                    {isScored(q) && <span className="muted">✔ saved — clear the box to unset</span>}
                  </div>
                  {q.entry_format === 'text' && (
                    <div className="admin-text-answers">
                      {picks.filter((p) => p.question_id === q.id && p.entry_text != null).length === 0 ? (
                        <span className="muted">No member answers yet.</span>
                      ) : (
                        <>
                          <span className="muted">Member answers — tap ✓ for anyone who deserves the point:</span>
                          <ul>
                            {picks
                              .filter((p) => p.question_id === q.id && p.entry_text != null)
                              .map((p) => (
                                <li key={p.id}>
                                  <strong>{nameOf(p.user_id)}:</strong> {p.entry_text}
                                  <button
                                    className={`option-btn sm ${p.is_correct === true ? 'correct' : ''}`}
                                    onClick={() => markTextPick(p.id, true)}
                                  >
                                    ✓
                                  </button>
                                  <button
                                    className={`option-btn sm ${p.is_correct === false ? 'wrong' : ''}`}
                                    onClick={() => markTextPick(p.id, false)}
                                  >
                                    ✗
                                  </button>
                                </li>
                              ))}
                          </ul>
                        </>
                      )}
                    </div>
                  )}
                </>
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
                <option value="duration">Time (H:MM:SS) — closest without going over</option>
                <option value="number">Number — closest without going over</option>
                <option value="text">Text fill-in — admin marks who's right</option>
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
            Points for a correct pick (0 = tiebreaker only)
            <input
              type="number"
              min={0}
              value={points}
              onChange={(e) => setPoints(Number.isFinite(parseInt(e.target.value, 10)) ? parseInt(e.target.value, 10) : 1)}
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
          {armed === 'delete-event' ? 'Tap again — this is permanent' : 'Delete this event'}
        </button>
      </section>
    </div>
  )
}
