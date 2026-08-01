import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { STATUS_LABELS, type LeagueEvent } from '../lib/types'

interface LeagueSettings {
  id: boolean
  league_name: string
  invite_code: string
  admin_email: string
}

interface RosterRow {
  user_id: string
  display_name: string
  email: string
  is_admin: boolean
  joined_at: string
  last_sign_in_at: string | null
  picks_on_latest: number
  latest_event_name: string | null
  latest_event_questions: number
}

export default function AdminPage() {
  const [events, setEvents] = useState<LeagueEvent[]>([])
  const [settings, setSettings] = useState<LeagueSettings | null>(null)
  const [roster, setRoster] = useState<RosterRow[]>([])
  const [name, setName] = useState('')
  const [promotion, setPromotion] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [codeSaved, setCodeSaved] = useState(false)

  async function load() {
    const [evRes, setRes, rosterRes] = await Promise.all([
      supabase.from('events').select('*').order('event_date', { ascending: false, nullsFirst: false }),
      supabase.from('league_settings').select('*').single(),
      supabase.rpc('admin_roster'),
    ])
    setEvents((evRes.data as LeagueEvent[]) ?? [])
    setSettings(setRes.data as LeagueSettings | null)
    setRoster((rosterRes.data as RosterRow[]) ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  async function createEvent(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('events').insert({
      name: name.trim(),
      promotion: promotion.trim() || null,
      event_date: date || null,
    })
    if (error) setError(error.message)
    else {
      setName('')
      setPromotion('')
      setDate('')
      await load()
    }
    setBusy(false)
  }

  async function saveInviteCode(e: FormEvent) {
    e.preventDefault()
    if (!settings) return
    const { error } = await supabase
      .from('league_settings')
      .update({ invite_code: settings.invite_code.trim() })
      .eq('id', true)
    if (error) setError(error.message)
    else {
      setCodeSaved(true)
      setTimeout(() => setCodeSaved(false), 2000)
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">Commissioner’s Office</h1>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="card admin-section">
        <h2 className="section-title">Roster ({roster.length})</h2>
        {roster.length === 0 ? (
          <p className="muted">Nobody has joined yet.</p>
        ) : (
          <>
            {roster[0].latest_event_name && (
              <p className="muted">
                Pick progress shown for: <strong>{roster[0].latest_event_name}</strong>
              </p>
            )}
            <div className="table-scroll">
              <table className="roster-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Email</th>
                    <th>Joined</th>
                    <th>Picks</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((r) => {
                    const done = r.picks_on_latest >= r.latest_event_questions && r.latest_event_questions > 0
                    return (
                      <tr key={r.user_id}>
                        <td>
                          {r.display_name}
                          {r.is_admin && <span className="chip chip-prop roster-chip">Commish</span>}
                        </td>
                        <td className="roster-email">{r.email}</td>
                        <td className="muted">
                          {new Date(r.joined_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </td>
                        <td className={done ? 'roster-done' : r.picks_on_latest === 0 ? 'roster-none' : ''}>
                          {r.latest_event_questions > 0
                            ? `${r.picks_on_latest}/${r.latest_event_questions}${done ? ' ✔' : ''}`
                            : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card admin-section">
        <h2 className="section-title">Invite Code</h2>
        <p className="muted">Share this code with people you want in the league. Change it any time to close the door.</p>
        {settings && (
          <form onSubmit={saveInviteCode} className="inline-form">
            <input
              value={settings.invite_code}
              onChange={(e) => setSettings({ ...settings, invite_code: e.target.value })}
            />
            <button className="btn btn-secondary" type="submit">
              {codeSaved ? 'Saved ✔' : 'Save Code'}
            </button>
          </form>
        )}
      </section>

      <section className="card admin-section">
        <h2 className="section-title">Create Event</h2>
        <form onSubmit={createEvent} className="admin-form">
          <label>
            Event name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SummerSlam 2026" required />
          </label>
          <label>
            Promotion (optional)
            <input value={promotion} onChange={(e) => setPromotion(e.target.value)} placeholder="e.g. WWE, AEW" />
          </label>
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            Create Event
          </button>
        </form>
        <p className="muted">New events start as drafts — members can’t see them until you open picks.</p>
      </section>

      <section className="admin-section">
        <h2 className="section-title">All Events</h2>
        {events.length === 0 && <p className="muted">No events yet.</p>}
        <div className="admin-event-list">
          {events.map((ev) => (
            <Link key={ev.id} to={`/admin/events/${ev.id}`} className="admin-event-row">
              <span className={`badge badge-${ev.status}`}>{STATUS_LABELS[ev.status]}</span>
              <span className="admin-event-name">{ev.name}</span>
              <span className="admin-event-date">{ev.event_date ?? 'TBA'}</span>
              <span className="admin-event-edit">Manage →</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
