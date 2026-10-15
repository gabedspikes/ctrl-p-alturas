import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { setErrorUser, logError } from './errorLog'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined) // undefined = still loading

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) logError('auth.getSession', error)
      setUser(session?.user ?? null)
      setErrorUser(session?.user?.email)
    }).catch(err => {
      // Sin red al abrir la app: no dejar al usuario pegado en "Loading…"
      logError('auth.getSession', err)
      setUser(null)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
        setErrorUser(session?.user?.email)
      }
    )
    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}