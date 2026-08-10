import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type Mode = 'signin' | 'signup'

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [realName, setRealName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) setError(error.message)
      } else {
        if (!displayName.trim()) {
          setError('Pick a display name — it shows on the leaderboard.')
          return
        }
        const { data: valid, error: rpcError } = await supabase.rpc('validate_invite', {
          code: inviteCode,
        })
        if (rpcError) {
          setError(rpcError.message)
          return
        }
        if (!valid) {
          setError('That invite code is not valid. Ask the commissioner for the current code.')
          return
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: displayName.trim(),
              invite_code: inviteCode.trim(),
              real_name: realName.trim(),
            },
          },
        })
        if (error) {
          setError(error.message)
        } else if (data.session) {
          // signed in immediately (email confirmation disabled)
        } else {
          setNotice('Check your email to confirm your account, then sign in.')
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-banner">
        <picture>
          <source
            media="(max-width: 640px)"
            srcSet="https://i.postimg.cc/ZnbjLym6/Chat-GPT-Image-Aug-3-2026-03-17-13-PM.png"
          />
          <img
            src="https://i.postimg.cc/90m1Bq2Z/Chat-GPT-Image-Aug-3-2026-03-14-00-PM.png"
            alt="Fantasy Pick'em League — SummerSlam, Money in the Bank, Survivor Series, Royal Rumble, WrestleMania"
          />
        </picture>
      </div>
      <div className="auth-card">
        <div className="auth-hero">
          <div className="auth-belt">🏆</div>
          <h1>
            Fantasy <em>Wrestling</em>
          </h1>
          <p>Call every finish. Claim the belt.</p>
        </div>

        <div className="auth-tabs">
          <button
            className={mode === 'signin' ? 'active' : ''}
            onClick={() => {
              setMode('signin')
              setError(null)
              setNotice(null)
            }}
          >
            Sign In
          </button>
          <button
            className={mode === 'signup' ? 'active' : ''}
            onClick={() => {
              setMode('signup')
              setError(null)
              setNotice(null)
            }}
          >
            Join League
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {mode === 'signup' && (
            <>
              <label>
                Display name
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Macho Man Randy"
                  maxLength={30}
                  required
                />
              </label>
              <label>
                First name
                <input
                  value={realName}
                  onChange={(e) => setRealName(e.target.value)}
                  placeholder="Shows on the standings next to your team name"
                  maxLength={60}
                  required
                />
              </label>
              <label>
                Invite code
                <input
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="League invite code"
                  required
                />
              </label>
            </>
          )}
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={6}
              required
            />
          </label>

          {error && <div className="alert alert-error">{error}</div>}
          {notice && <div className="alert alert-ok">{notice}</div>}

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Working…' : mode === 'signin' ? 'Sign In' : 'Join the League'}
          </button>
        </form>
      </div>
    </div>
  )
}
