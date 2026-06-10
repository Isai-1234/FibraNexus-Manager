import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import axios from 'axios'
import Login from './pages/auth/Login'
import AdminDashboard from './pages/admin/Dashboard'

const API = 'https://fibranexus-manager.onrender.com/api'

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
      axios.get(API + '/auth/me', { headers: { Authorization: 'Bearer ' + token } })
        .then(res => { console.log('User loaded:', res.data); setUser(res.data) })
        .catch(err => { console.error('Auth error:', err); localStorage.removeItem('token') })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const login = async (email: string, password: string) => {
    console.log('Logging in:', email)
    const res = await axios.post(API + '/auth/login', { email, password })
    console.log('Login response:', res.data)
    localStorage.setItem('token', res.data.token)
    setUser(res.data.user)
  }

  if (loading) return (
    <div className="flex h-screen items-center justify-center bg-gradient-to-br from-blue-600 to-purple-700">
      <div className="text-white text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
        <p className="text-xl">Cargando FibraNexus Manager...</p>
      </div>
    </div>
  )

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={!user ? <Login onLogin={login} /> : <Navigate to="/" />} />
        <Route path="/*" element={user ? <AdminDashboard user={user} API={API} /> : <Navigate to="/login" />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
