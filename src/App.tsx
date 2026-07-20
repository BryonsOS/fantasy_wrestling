import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import AuthPage from './pages/AuthPage'
import EventsPage from './pages/EventsPage'
import EventPage from './pages/EventPage'
import LeaderboardPage from './pages/LeaderboardPage'
import AdminPage from './pages/AdminPage'
import AdminEventPage from './pages/AdminEventPage'

export default function App() {
  const { session, profile, loading } = useAuth()

  if (loading) {
    return <div className="page-loading">Loading…</div>
  }

  if (!session) {
    return <AuthPage />
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<EventsPage />} />
        <Route path="/events/:id" element={<EventPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        {profile?.is_admin && (
          <>
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/admin/events/:id" element={<AdminEventPage />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
