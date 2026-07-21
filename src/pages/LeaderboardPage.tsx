import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { scoreForUser } from '../lib/score'
import type { LeagueEvent, Pick, Profile, Question } from '../lib/types'

interface Standing {
  profile: Profile
  total: number
  perEvent: Map<string, number>
}

export default function LeaderboardPage() {
  const { session } = useAuth()
  const userId = session!.user.id
  const [events, setEvents] = useState<LeagueEvent[]>([])
  const [standings, setStandings] = useState<Standing[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: evData } = await supabase
        .from('events')
        .select('*')
        .eq('status', 'final')
        .order('event_date', { ascending: true, nullsFirst: true })
      const finals = (evData as LeagueEvent[]) ?? []
      const { data: profData } = await supabase.from('profiles').select('*').order('display_name')
      const profiles = (profData as Profile[]) ?? []

      if (finals.length === 0) {
        setEvents([])
        setStandings(
          profiles.map((p) => ({ profile: p, total: 0, perEvent: new Map() })),
        )
        setLoading(false)
        return
      }

      const eventIds = finals.map((e) => e.id)
      const { data: qData } = await supabase
        .from('questions')
        .select('*, options!question_id(*)')
        .in('event_id', eventIds)
      const questions = (qData as Question[]) ?? []
      const { data: pickData } = await supabase
        .from('picks')
        .select('*, questions!inner(event_id)')
        .in('questions.event_id', eventIds)
      const picks = (((pickData as (Pick & { questions: { event_id: string } })[]) ?? [])).map(
        (p) => ({ ...p }),
      )

      const rows: Standing[] = profiles.map((pr) => {
        const perEvent = new Map<string, number>()
        let total = 0
        for (const ev of finals) {
          const evQs = questions.filter((q) => q.event_id === ev.id)
          const s = scoreForUser(pr.id, evQs, picks)
          perEvent.set(ev.id, s)
          total += s
        }
        return { profile: pr, total, perEvent }
      })
      rows.sort((a, b) => b.total - a.total || a.profile.display_name.localeCompare(b.profile.display_name))

      setEvents(finals)
      setStandings(rows)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div className="page-loading">Tallying the scores…</div>

  const seasonComplete = events.some((e) => e.is_finale)
  const champion = seasonComplete && standings.length > 0 && standings[0].total > 0 ? standings[0] : null

  return (
    <div className="page">
      <h1 className="page-title">League Standings</h1>

      {champion && (
        <div className="champion-banner">
          <div className="champion-belt">🏆</div>
          <div>
            <div className="champion-label">Ultimate Champion</div>
            <div className="champion-name">{champion.profile.display_name}</div>
            <div className="champion-pts">{champion.total} points across {events.length} events</div>
          </div>
        </div>
      )}

      {events.length === 0 ? (
        <div className="empty-state">
          <p>No events have gone final yet — the belt is still up for grabs.</p>
          {standings.length > 0 && (
            <p className="muted">
              {standings.length} {standings.length === 1 ? 'member is' : 'members are'} in the league.
            </p>
          )}
        </div>
      ) : (
        <div className="table-scroll">
          <table className="standings">
            <thead>
              <tr>
                <th className="rank-col">#</th>
                <th className="name-col">Member</th>
                {events.map((ev) => (
                  <th key={ev.id} className="event-col">
                    <Link to={`/events/${ev.id}`}>{ev.name}</Link>
                  </th>
                ))}
                <th className="total-col">Total</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s, i) => (
                <tr key={s.profile.id} className={s.profile.id === userId ? 'me' : ''}>
                  <td className="rank-col">
                    {i === 0 && s.total > 0 ? '🏆' : i + 1}
                  </td>
                  <td className="name-col">{s.profile.display_name}</td>
                  {events.map((ev) => (
                    <td key={ev.id} className="event-col">
                      {s.perEvent.get(ev.id) ?? 0}
                    </td>
                  ))}
                  <td className="total-col">{s.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
