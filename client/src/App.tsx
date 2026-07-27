import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import axios from 'axios'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import ForgotPassword from './pages/auth/ForgotPassword'
import ResetPassword from './pages/auth/ResetPassword'
import AdminDashboard from './pages/admin/Dashboard'
import ClientPortal from './pages/portal/ClientPortal'
import SuspendedNotice from './pages/portal/SuspendedNotice'
import IspLogin from './pages/auth/IspLogin'
import PlatformDashboard from './pages/platform/PlatformDashboard'

const API = import.meta.env.VITE_API_URL || '/api'

function applySession(res: { data: any }, setUser: (u: any) => void) {
  const data = res.data
  if (data.token) {
    localStorage.setItem('token', data.token)
    const { token: _, ...userData } = data
    setUser(userData)
  } else {
    setUser(data)
  }
}

function AppShell({ user, API }: { user: any; API: string }) {
  if (user.role === 'superadmin') {
    return <PlatformDashboard user={user} API={API} />
  }
  if (user.role === 'client') {
    return <ClientPortal user={user} API={API} />
  }
  return <AdminDashboard user={user} API={API} />
}

function App() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
      axios.get(API + '/auth/me', { headers: { Authorization: 'Bearer ' + token } })
        .then(res => applySession(res, setUser))
        .catch(() => localStorage.removeItem('token'))
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const login = async (email: string, password: string) => {
    const res = await axios.post(API + '/auth/login', { email, password })
    localStorage.setItem('token', res.data.token)
    setUser(res.data.user)
  }

  if (loading) {
    const onPortalPath = typeof window !== 'undefined'
      && /^\/(portal|mora)\//.test(window.location.pathname)
    return (
      <div className={`flex h-screen items-center justify-center ${
        onPortalPath ? 'bg-[#f3eee6]' : 'bg-gradient-to-br from-blue-600 to-indigo-800'
      }`}>
        <div className={`text-center ${onPortalPath ? 'text-slate-600' : 'text-white'}`}>
          <div className={`animate-spin rounded-full h-10 w-10 border-2 mx-auto mb-3 ${
            onPortalPath ? 'border-slate-300 border-b-slate-700' : 'border-white/40 border-b-white'
          }`} />
          <p className="text-sm font-medium">{onPortalPath ? 'Cargando tu cuenta…' : 'Cargando…'}</p>
        </div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/suspended" element={<SuspendedNotice />} />
        <Route path="/mora/:slug" element={<SuspendedNotice />} />
        <Route path="/portal/:slug" element={!user ? <IspLogin onLogin={login} /> : <Navigate to="/" />} />
        <Route path="/login" element={!user ? <Login onLogin={login} /> : <Navigate to="/" />} />
        <Route path="/register" element={!user ? <Register onRegister={setUser} /> : <Navigate to="/" />} />
        <Route path="/forgot-password" element={!user ? <ForgotPassword /> : <Navigate to="/" />} />
        <Route path="/reset-password" element={!user ? <ResetPassword /> : <Navigate to="/" />} />
        <Route path="/*" element={user ? <AppShell user={user} API={API} /> : <Navigate to="/login" />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
