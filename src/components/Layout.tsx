import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

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
      <main className="main">{children}</main>
      <footer className="footer">Predict the card. Talk the trash. Take the belt.</footer>
    </div>
  )
}
