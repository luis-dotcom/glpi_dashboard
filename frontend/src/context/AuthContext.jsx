import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { api } from '../api'

const AuthContext = createContext(null)

const withTimeout = (promise, ms = 8000) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms)),
  ])
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadUser = useCallback(async () => {
    try {
      await withTimeout(api.auth.csrf(), 5000)
      const data = await withTimeout(api.auth.me(), 5000)
      setUser(data.user ?? null)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadUser()
  }, [loadUser])

  const login = async (username, password) => {
    const data = await api.auth.login(username, password)
    setUser(data.user)
    return data
  }

  const logout = async () => {
    await api.auth.logout()
    setUser(null)
  }

  const value = { user, loading, login, logout, refreshUser: loadUser }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
