import { createContext, useContext } from 'react'
import { useWebSocket } from '../hooks/useWebSocket'
import { useAuth } from './AuthContext'

const WebSocketContext = createContext(null)

export function WebSocketProvider({ children }) {
  const { user } = useAuth()
  const ws = useWebSocket(user?.username ?? '')

  return (
    <WebSocketContext.Provider value={ws}>
      {children}
    </WebSocketContext.Provider>
  )
}

export function useWS() {
  const ctx = useContext(WebSocketContext)
  return ctx || {
    connected: false,
    send: async () => { throw new Error('WebSocket não disponível') },
    sendStream: async () => { throw new Error('WebSocket não disponível') },
  }
}
