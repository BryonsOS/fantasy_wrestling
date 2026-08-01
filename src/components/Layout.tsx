import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

function RealNamePrompt() {
  const { session } = useAuth()
  const userId = session!.user.id
  const [show, setShow] = useState(false)
  const [value, setValue] = useState('')

  useEffect(() => {
    supabase
      .from('member_details')
      .select('real_name')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data || !data.real_name) setShow(true)
      })
  }, [userId])

  async function save(e: FormEvent) {
    e.preventDefault()
    const name = value.trim()
    if (!name) return
    const { error } = await supabase
      .from('member_details')
      .upsert({ user_id: userId, real_name: name })
    if (!error) setShow(false)
  }

  if (!show) return null
  return (
    <form className="name-prompt" onSubmit={save}>
      <span>👋 What’s your first name? It shows next to your team name on the standings so the league knows who’s who.</span>
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="First name" maxLength={60} />
      <button className="btn btn-secondary btn-sm" type="submit" disabled={!value.trim()}>
        Save
      </button>
    </form>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth()

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">
            <span className="brand-belt">🏆</span>
            <span className="brand-text">
              Fantasy <em>Wrestling</em>
            </span>
          </NavLink>
          <nav className="nav">
            <NavLink to="/" end>
              Events
            </NavLink>
            <NavLink to="/leaderboard">Standings</NavLink>
            <NavLink to="/chat">Locker Room</NavLink>
            {profile?.is_admin && <NavLink to="/admin">Admin</NavLink>}
          </nav>
          <div className="topbar-user">
            <span className="user-name">{profile?.display_name}</span>
            <button className="btn btn-ghost btn-sm" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="main">
        <RealNamePrompt />
        {children}
      </main>
      <footer className="footer">Predict the card. Talk the trash. Take the belt.</footer>
    </div>
  )
}
