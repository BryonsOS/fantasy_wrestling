import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { Profile } from '../lib/types'

interface Message {
  id: string
  user_id: string
  body: string
  created_at: string
}

export default function ChatPage() {
  const { session, profile } = useAuth()
  const userId = session!.user.id
  const [messages, setMessages] = useState<Message[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const firstScroll = useRef(true)

  useEffect(() => {
    let active = true

    async function load() {
      const [mRes, pRes] = await Promise.all([
        supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(200),
        supabase.from('profiles').select('*'),
      ])
      if (!active) return
      setMessages((((mRes.data as Message[]) ?? [])).reverse())
      setProfiles((pRes.data as Profile[]) ?? [])
      setLoading(false)
    }
    load()

    const channel = supabase
      .channel('locker-room')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const msg = payload.new as Message
          setMessages((cur) => (cur.some((m) => m.id === msg.id) ? cur : [...cur, msg]))
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages' },
        (payload) => {
          const gone = payload.old as { id: string }
          setMessages((cur) => cur.filter((m) => m.id !== gone.id))
        },
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: firstScroll.current ? 'auto' : 'smooth' })
    if (messages.length > 0) firstScroll.current = false
  }, [messages.length])

  async function send(e: FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)
    const { data, error } = await supabase
      .from('messages')
      .insert({ user_id: userId, body })
      .select()
      .single()
    if (error) {
      setError('Message didn’t send — try again.')
    } else if (data) {
      const msg = data as Message
      setMessages((cur) => (cur.some((m) => m.id === msg.id) ? cur : [...cur, msg]))
      setText('')
    }
    setSending(false)
  }

  async function remove(id: string) {
    const { error } = await supabase.from('messages').delete().eq('id', id)
    if (!error) setMessages((cur) => cur.filter((m) => m.id !== id))
  }

  const nameOf = (uid: string) => profiles.find((p) => p.id === uid)?.display_name ?? 'Former member'

  function stamp(iso: string) {
    const d = new Date(iso)
    const today = new Date()
    const sameDay = d.toDateString() === today.toDateString()
    return sameDay
      ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
          ' ' +
          d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }

  if (loading) return <div className="page-loading">Opening the Locker Room…</div>

  return (
    <div className="page chat-page">
      <h1 className="page-title">The Locker Room</h1>
      <p className="muted chat-sub">League-wide chat. Messages show up live — talk your trash.</p>

      <div className="chat-box">
        <div className="chat-scroll">
          {messages.length === 0 && (
            <div className="empty-state">
              <p>Dead silence… someone cut a promo already.</p>
            </div>
          )}
          {messages.map((m, i) => {
            const mine = m.user_id === userId
            const showName = i === 0 || messages[i - 1].user_id !== m.user_id
            return (
              <div key={m.id} className={`chat-msg ${mine ? 'mine' : ''}`}>
                {showName && (
                  <div className="chat-meta">
                    <span className="chat-name">{nameOf(m.user_id)}</span>
                    <span className="chat-time">{stamp(m.created_at)}</span>
                  </div>
                )}
                <div className="chat-bubble-row">
                  <div className="chat-bubble">{m.body}</div>
                  {(mine || profile?.is_admin) && (
                    <button className="chat-delete" title="Delete" onClick={() => remove(m.id)}>
                      ✕
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          <div ref={endRef} />
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form className="chat-input" onSubmit={send}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Say it to their face…"
            maxLength={1000}
          />
          <button className="btn btn-primary" type="submit" disabled={sending || !text.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  )
}
