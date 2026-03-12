import { useEffect, useRef, useState, useCallback } from 'react'

/**
 * Hook para comunicação em tempo real via WebSocket.
 * Quando o backend envia dados, o estado é atualizado imediatamente.
 * @param {string} reconnectKey - Quando muda (ex: user?.username), reconecta para pegar nova sessão
 */
export function useWebSocket(reconnectKey = '') {
  const wsRef = useRef(null)
  const [connected, setConnected] = useState(false)
  const [lastData, setLastData] = useState(null)
  const pendingRef = useRef(new Map())
  const reconnectKeyRef = useRef(reconnectKey)

  const getWsUrl = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    return `${protocol}//${host}/ws/`
  }

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.close()
    }

    const url = getWsUrl()
    const ws = new WebSocket(url)

    ws.onopen = () => setConnected(true)
    ws.onclose = () => {
      setConnected(false)
      wsRef.current = null
      if (reconnectKeyRef.current) setTimeout(connect, 2000)
    }
    ws.onerror = () => {}

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        const { type, data, status, error } = msg

        const streamHandlers = {
          colaboradores_chunk: 'get_colaboradores_stream_stream',
          colaboradores_done: 'get_colaboradores_stream_stream',
          colaboradores_error: 'get_colaboradores_stream_stream',
          relatorios_chunk: 'get_relatorios_stream_stream',
          relatorios_done: 'get_relatorios_stream_stream',
          relatorios_error: 'get_relatorios_stream_stream',
          desempenho_chunk: 'get_desempenho_stream_stream',
          desempenho_done: 'get_desempenho_stream_stream',
          desempenho_error: 'get_desempenho_stream_stream',
        }
        const streamKey = streamHandlers[type]
        if (streamKey) {
          const pending = pendingRef.current.get(streamKey)
          if (type.endsWith('_chunk') && pending?.onChunk) {
            pending.onChunk(data)
          } else if (type.endsWith('_done') && pending) {
            pending.resolve(data)
            pendingRef.current.delete(streamKey)
          } else if (type.endsWith('_error') && pending) {
            pending.reject(new Error(error || 'Erro'))
            pendingRef.current.delete(streamKey)
          }
          setLastData({ type, data })
          return
        }

        if (status === 'ok') {
          setLastData({ type, data })
          const pending = pendingRef.current.get(type)
          if (pending) {
            pending.resolve(data)
            pendingRef.current.delete(type)
          }
        } else {
          const pending = pendingRef.current.get(type)
          if (pending) {
            pending.reject(new Error(error || 'Erro'))
            pendingRef.current.delete(type)
          }
        }
      } catch (e) {
        console.error('WS parse error:', e)
      }
    }

    wsRef.current = ws
  }, [])

  useEffect(() => {
    reconnectKeyRef.current = reconnectKey
    connect()
    return () => {
      reconnectKeyRef.current = ''
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      setConnected(false)
    }
  }, [connect, reconnectKey])

  const send = useCallback((type, payload = {}) => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket não conectado'))
        return
      }

      pendingRef.current.set(type, { resolve, reject })
      wsRef.current.send(JSON.stringify({ type, payload }))

      // Timeout 5 min para streaming (Colaboradores)
      const timeout = type === 'get_colaboradores_stream' ? 300000 : 60000
      setTimeout(() => {
        if (pendingRef.current.has(type)) {
          pendingRef.current.delete(type)
          reject(new Error('Timeout'))
        }
      }, timeout)
    })
  }, [])

  /** Envia requisição e recebe chunks progressivamente (para get_colaboradores_stream) */
  const sendStream = useCallback((type, payload = {}, onChunk) => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket não conectado'))
        return
      }

      const streamKey = `${type}_stream`
      pendingRef.current.set(streamKey, { resolve, reject, onChunk })
      wsRef.current.send(JSON.stringify({ type, payload }))

      setTimeout(() => {
        if (pendingRef.current.has(streamKey)) {
          pendingRef.current.delete(streamKey)
          reject(new Error('Timeout'))
        }
      }, 300000)
    })
  }, [])

  return { connected, send, sendStream, lastData }
}
