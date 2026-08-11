import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { CameraIcon } from '../components/icons'
import type { Profile } from '../lib/types'

interface Message {
  id: string
  user_id: string
  body: string | null
  image_path: string | null
  created_at: string
}

const BUCKET = 'chat-images'

function imageUrl(path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

/** Downscale to max 1600px JPEG so phone photos upload fast and stay small. */
async function downscaleImage(file: File, maxDim = 1600): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.85),
    )
  } catch {
    // fall back to the original file if the browser can't decode/re-encode it
    if (file.size <= 5 * 1024 * 1024) return file
    throw new Error('too big')
  }
}

export default function ChatPage() {
  const { session, profile } = useAuth()
  const userId = session!.user.id
  const [messages, setMessages] = useState<Message[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [text, setText] = useState('')
  const [pendingImage, setPendingImage] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
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

  function pickImage(file: File | null) {
    if (preview) URL.revokeObjectURL(preview)
    setPendingImage(file)
    setPreview(file ? URL.createObjectURL(file) : null)
  }

  async function send(e: FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if ((!body && !pendingImage) || sending) return
    setSending(true)
    setError(null)
    try {
      let imagePath: string | null = null
      if (pendingImage) {
        const blob = await downscaleImage(pendingImage)
        imagePath = `${userId}/${crypto.randomUUID()}.jpg`
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(imagePath, blob, { contentType: 'image/jpeg' })
        if (upErr) throw upErr
      }
      const { data, error } = await supabase
        .from('messages')
        .insert({ user_id: userId, body: body || null, image_path: imagePath })
        .select()
        .single()
      if (error) throw error
      const msg = data as Message
      setMessages((cur) => (cur.some((m) => m.id === msg.id) ? cur : [...cur, msg]))
      setText('')
      pickImage(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch {
      setError('Message didn’t send — try again (images must be under ~5MB).')
    }
    setSending(false)
  }

  async function remove(m: Message) {
    const { error } = await supabase.from('messages').delete().eq('id', m.id)
    if (!error) {
      setMessages((cur) => cur.filter((x) => x.id !== m.id))
      if (m.image_path) {
        // best-effort cleanup of the stored file
        supabase.storage.from(BUCKET).remove([m.image_path])
      }
    }
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
                  <div className="chat-bubble">
                    {m.image_path && (
                      <a href={imageUrl(m.image_path)} target="_blank" rel="noreferrer">
                        <img className="chat-img" src={imageUrl(m.image_path)} loading="lazy" alt="" />
                      </a>
                    )}
                    {m.body}
                  </div>
                  {(mine || profile?.is_admin) && (
                    <button className="chat-delete" title="Delete" onClick={() => remove(m)}>
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

        {preview && (
          <div className="chat-attach-preview">
            <img src={preview} alt="attachment preview" />
            <button
              type="button"
              className="btn btn-ghost btn-sm danger"
              onClick={() => {
                pickImage(null)
                if (fileRef.current) fileRef.current.value = ''
              }}
            >
              Remove
            </button>
          </div>
        )}

        <form className="chat-input" onSubmit={send}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="btn btn-secondary chat-attach-btn"
            title="Attach a photo"
            onClick={() => fileRef.current?.click()}
          >
            <CameraIcon />
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Say it to their face…"
            maxLength={1000}
          />
          <button
            className="btn btn-primary"
            type="submit"
            disabled={sending || (!text.trim() && !pendingImage)}
          >
            {sending ? '…' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  )
}
