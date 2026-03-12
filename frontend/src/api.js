/**
 * Cliente API - comunicação com o backend Django
 */

const getCsrfToken = () => {
  const name = 'csrftoken'
  const cookies = document.cookie.split(';')
  for (let c of cookies) {
    const [key, val] = c.trim().split('=')
    if (key === name) return val
  }
  return null
}

const apiFetch = async (path, options = {}) => {
  const method = options.method || 'GET'
  const isSafe = ['GET', 'HEAD', 'OPTIONS'].includes(method)
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  }
  if (!isSafe) {
    const csrf = getCsrfToken()
    if (csrf) headers['X-CSRFToken'] = csrf
  }
  const timeout = options.timeout ?? 120000 // 2 min default, 5 min para Colaboradores
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)
  const res = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'include',
    signal: controller.signal,
  })
  clearTimeout(id)
  if (res.status === 401) {
    throw new Error('UNAUTHORIZED')
  }
  if (res.status >= 400) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || data.detail || `Erro ${res.status}`)
  }
  const contentType = res.headers.get('content-type')
  if (contentType && contentType.includes('application/json')) {
    return res.json()
  }
  return res
}

export const api = {
  auth: {
    login: (username, password) =>
      apiFetch('/auth/login/', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    logout: () => apiFetch('/auth/logout/', { method: 'POST' }),
    me: () => apiFetch('/auth/me/'),
    csrf: () => apiFetch('/auth/csrf/'),
  },
  portal: {
    desempenho: (ano) => apiFetch(`/portal/desempenho/${ano ? `?ano=${ano}` : ''}`),
    colaboradores: (dataInicio, dataFim) => {
      const params = new URLSearchParams()
      if (dataInicio) params.set('data_inicio', dataInicio)
      if (dataFim) params.set('data_fim', dataFim)
      return apiFetch(`/portal/colaboradores/?${params}`, { timeout: 300000 })
    },
  },
  relatorios: {
    filters: () => apiFetch('/relatorios/filters/'),
    list: (filters = {}, page = 1, limit = 20) => {
      const params = new URLSearchParams({ ...filters, page, limit })
      return apiFetch(`/relatorios/?${params}`)
    },
    exportUrl: (type, filters = {}) => {
      const params = new URLSearchParams({ type, ...filters })
      return `/api/relatorios/export/?${params}`
    },
  },
}
