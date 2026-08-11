import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { LiveDot } from '../components/icons'
import { countdownText } from '../lib/time'
import { STATUS_LABELS, type LeagueEvent } from '../lib/types'

export default function EventsPage() {
  const [events, setEvents] = useState<LeagueEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('events')
      .select('*')
      .neq('status', 'draft')
      .order('event_date', { ascending: false, nullsFirst: false })
      .then(({ data }) => {
        setEvents((data as LeagueEvent[]) ?? [])
        setLoading(false)
      })
  }, [])

  if (loading) return <div className="page-loading">Loading events…</div>

  const active = events.filter((e) => e.status === 'open' || e.status === 'locked')
  const finished = events.filter((e) => e.status === 'final')

  return (
    <div className="page">
      <h1 className="page-title">Event Cards</h1>

      {events.length === 0 && (
        <div className="empty-state">
          <p>No events posted yet. The commissioner will post the next card soon.</p>
        </div>
      )}

      {active.length > 0 && (
        <section>
          <h2 className="section-title">On the Marquee</h2>
          <div className="event-grid">
            {active.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        </section>
      )}

      {finished.length > 0 && (
        <section>
          <h2 className="section-title">In the Books</h2>
          <div className="event-grid">
            {finished.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function EventCard({ event }: { event: LeagueEvent }) {
  const date = event.event_date
    ? new Date(event.event_date + 'T00:00:00').toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Date TBA'

  return (
    <Link to={`/events/${event.id}`} className={`event-card status-${event.status}`}>
      <div className="event-card-top">
        {event.promotion && <span className="event-promotion">{event.promotion}</span>}
        <span className={`badge badge-${event.status}`}>{STATUS_LABELS[event.status]}</span>
      </div>
      <h3 className="event-name">{event.name}</h3>
      <div className="event-date">{date}</div>
      {event.status === 'open' && event.locks_at && (
        <div className="lock-countdown">{countdownText(event.locks_at, Date.now())}</div>
      )}
      <div className="event-cta">
        {event.status === 'open' && 'Make your picks →'}
        {event.status === 'locked' && (<><LiveDot />Live — scores & everyone’s picks →</>)}
        {event.status === 'final' && 'See results →'}
      </div>
    </Link>
  )
}
