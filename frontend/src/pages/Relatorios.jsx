import { useState, useEffect, useCallback, useRef } from 'react'
import { useWS } from '../context/WebSocketContext'
import { api } from '../api'
import './Pages.css'

const PAGE_SIZE = 20

const relatoriosCache = { data: null, key: '' }

function getCacheKey(filters) {
  return JSON.stringify(filters || {})
}

export default function Relatorios() {
  const { send, sendStream, connected } = useWS()
  const [filters, setFilters] = useState({})
  const [filtersData, setFiltersData] = useState(null)
  const [chamados, setChamados] = useState(() => {
    const key = getCacheKey({})
    return relatoriosCache.key === key ? (relatoriosCache.data?.chamados || []) : []
  })
  const [summary, setSummary] = useState(() => {
    const key = getCacheKey({})
    return relatoriosCache.key === key ? (relatoriosCache.data?.summary || {}) : {}
  })
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState(() => {
    const key = getCacheKey({})
    return relatoriosCache.key === key ? (relatoriosCache.data?.pagination || { page: 1, totalPages: 1, total: 0 }) : { page: 1, totalPages: 1, total: 0 }
  })
  const filterChangeRef = useRef(false)
  const [loading, setLoading] = useState(() => {
    const key = getCacheKey({})
    return !(relatoriosCache.data && relatoriosCache.key === key)
  })
  const [loadingMore, setLoadingMore] = useState(false)
  const [streamProgress, setStreamProgress] = useState({ progress: 0, total: 0 })
  const [loadingFilters, setLoadingFilters] = useState(true)
  const [exporting, setExporting] = useState(null)

  useEffect(() => {
    const loadFilters = async () => {
      try {
        if (connected) {
          const res = await send('get_relatorios_filters', {})
          setFiltersData(res)
        } else {
          const res = await api.relatorios.filters()
          setFiltersData(res)
        }
      } catch {
        setFiltersData({ tecnicos: [], grupos: [], localizacoes: [], categorias: [] })
      } finally {
        setLoadingFilters(false)
      }
    }
    loadFilters()
  }, [connected, send])

  const load = useCallback(async (pageNum, forceRefresh = false) => {
    const cacheKey = getCacheKey(filters)
    if (!forceRefresh && relatoriosCache.key === cacheKey && relatoriosCache.data) {
      const cached = relatoriosCache.data
      setChamados(cached.chamados || [])
      setSummary(cached.summary || {})
      setPagination(cached.pagination || { page: 1, totalPages: 1, total: 0 })
      setPage(cached.pagination?.page ?? 1)
      setLoading(false)
      setLoadingMore(false)
      return
    }

    setLoading(true)
    setLoadingMore(false)
    try {
      if (connected) {
        const payload = { ...filters }
        const res = await sendStream(
          'get_relatorios_stream',
          payload,
          (chunk) => {
            const list = chunk.data || chunk.chamados || []
            setChamados(list)
            setSummary({
              total_chamados: chunk.total ?? chunk.total_chamados ?? list.length,
              chamados_fechados: chunk.chamados_fechados ?? 0,
              chamados_abertos: chunk.chamados_abertos ?? 0,
              total_tecnicos: chunk.total_tecnicos ?? 0,
              total_grupos: chunk.total_grupos ?? 0,
            })
            setPagination({
              page: 1,
              totalPages: Math.max(1, Math.ceil((chunk.total ?? list.length) / PAGE_SIZE)),
              total: chunk.total ?? list.length,
            })
            setLoading(false)
            const totalTickets = chunk.total_tickets ?? chunk.total ?? 0
            setStreamProgress({ progress: chunk.progress ?? list.length, total: totalTickets })
            setLoadingMore(chunk.progress < totalTickets)
          }
        )
        const list = res.data || res.chamados || []
        setChamados(list)
        setSummary({
          total_chamados: res.total ?? res.total_chamados ?? list.length,
          chamados_fechados: res.chamados_fechados ?? 0,
          chamados_abertos: res.chamados_abertos ?? 0,
          total_tecnicos: res.total_tecnicos ?? 0,
          total_grupos: res.total_grupos ?? 0,
        })
        setPagination({
          page: 1,
          totalPages: Math.max(1, Math.ceil((res.total ?? list.length) / PAGE_SIZE)),
          total: res.total ?? list.length,
        })
        setPage(1)
        setLoadingMore(false)
        relatoriosCache.data = {
          chamados: list,
          summary: {
            total_chamados: res.total ?? res.total_chamados ?? list.length,
            chamados_fechados: res.chamados_fechados ?? 0,
            chamados_abertos: res.chamados_abertos ?? 0,
            total_tecnicos: res.total_tecnicos ?? 0,
            total_grupos: res.total_grupos ?? 0,
          },
          pagination: {
            page: 1,
            totalPages: Math.max(1, Math.ceil((res.total ?? list.length) / PAGE_SIZE)),
            total: res.total ?? list.length,
          },
        }
        relatoriosCache.key = cacheKey
      } else {
        const res = await api.relatorios.list(filters, pageNum, PAGE_SIZE)
        const list = res.data || res.chamados || []
        setChamados(list)
        setSummary({
          total_chamados: res.total ?? res.total_chamados ?? 0,
          chamados_fechados: res.chamados_fechados ?? 0,
          chamados_abertos: res.chamados_abertos ?? 0,
          total_tecnicos: res.total_tecnicos ?? 0,
          total_grupos: res.total_grupos ?? 0,
        })
        setPagination({
          page: res.page ?? 1,
          totalPages: res.totalPages ?? 1,
          total: res.total ?? 0,
        })
        relatoriosCache.data = {
          chamados: list,
          summary: {
            total_chamados: res.total ?? res.total_chamados ?? 0,
            chamados_fechados: res.chamados_fechados ?? 0,
            chamados_abertos: res.chamados_abertos ?? 0,
            total_tecnicos: res.total_tecnicos ?? 0,
            total_grupos: res.total_grupos ?? 0,
          },
          pagination: {
            page: res.page ?? 1,
            totalPages: res.totalPages ?? 1,
            total: res.total ?? 0,
          },
        }
        relatoriosCache.key = cacheKey
      }
    } catch {
      setChamados([])
      setSummary({})
      setPagination({ page: 1, totalPages: 1, total: 0 })
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [filters, connected, sendStream])

  useEffect(() => {
    filterChangeRef.current = true
    setPage(1)
    load(1)
  }, [filters, load])

  useEffect(() => {
    if (filterChangeRef.current) {
      filterChangeRef.current = false
      return
    }
    if (!connected && page !== 1) load(page)
  }, [page, load, connected])

  const handlePage = (p) => {
    if (p >= 1 && p <= pagination.totalPages) {
      setPage(p)
    }
  }

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value || undefined }))
  }

  const handleExport = async (type) => {
    setExporting(type)
    try {
      const params = new URLSearchParams()
      params.set('type', type)
      Object.entries(filters).forEach(([k, v]) => {
        if (v != null && v !== '') params.set(k, v)
      })
      const url = `/api/relatorios/export/?${params}`
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) {
        const text = await res.text()
        let msg = 'Erro ao exportar'
        if (res.status === 401) msg = 'Sessão expirada. Faça login novamente.'
        else if (text) {
          try {
            const json = JSON.parse(text)
            msg = json.error || json.detail || text
          } catch {
            msg = text.slice(0, 100)
          }
        }
        throw new Error(msg)
      }
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = type === 'excel' ? 'relatorio_chamados.xlsx' : 'relatorio_chamados.pdf'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(a.href)
    } catch (err) {
      alert(err.message || 'Erro ao exportar')
    } finally {
      setExporting(null)
    }
  }

  const fd = filtersData || {}
  const tecnicos = fd.tecnicos || []
  const grupos = fd.grupos || []
  const localizacoes = fd.localizacoes || []
  const categorias = fd.categorias || []

  const getOptionValue = (item) => {
    if (typeof item === 'object' && item !== null) return item.id ?? item.name
    return item
  }

  const getOptionLabel = (item) => {
    if (typeof item === 'object' && item !== null) return item.name ?? item.id ?? String(item)
    return String(item)
  }

  return (
    <>
      <div className="page-header-flex">
        <h2>Relatórios</h2>
        <div className="export-buttons">
          <button
            type="button"
            className="btn-export"
            onClick={() => handleExport('excel')}
            disabled={!!exporting}
          >
            {exporting === 'excel' ? 'Exportando...' : 'Exportar Excel'}
          </button>
          <button
            type="button"
            className="btn-export"
            onClick={() => handleExport('pdf')}
            disabled={!!exporting}
          >
            {exporting === 'pdf' ? 'Exportando...' : 'Exportar PDF'}
          </button>
        </div>
      </div>

      <section className="content-card filter-section">
        <h3>Filtros</h3>
        <div className="filter-grid">
          <div className="filter-item">
            <label>Data início</label>
            <input
              type="date"
              value={filters.data_inicio || ''}
              onChange={(e) => handleFilterChange('data_inicio', e.target.value)}
            />
          </div>
          <div className="filter-item">
            <label>Data fim</label>
            <input
              type="date"
              value={filters.data_fim || ''}
              onChange={(e) => handleFilterChange('data_fim', e.target.value)}
            />
          </div>
          <div className="filter-item">
            <label>Técnico</label>
            <select
              value={filters.tecnico || ''}
              onChange={(e) => handleFilterChange('tecnico', e.target.value)}
            >
              <option value="">Todos</option>
              {tecnicos.map((t, i) => (
                <option key={i} value={getOptionValue(t)}>{getOptionLabel(t)}</option>
              ))}
            </select>
          </div>
          <div className="filter-item">
            <label>Grupo</label>
            <select
              value={filters.grupo || ''}
              onChange={(e) => handleFilterChange('grupo', e.target.value)}
            >
              <option value="">Todos</option>
              {grupos.map((g, i) => (
                <option key={i} value={getOptionValue(g)}>{getOptionLabel(g)}</option>
              ))}
            </select>
          </div>
          <div className="filter-item">
            <label>Localização</label>
            <select
              value={filters.localizacao || ''}
              onChange={(e) => handleFilterChange('localizacao', e.target.value)}
            >
              <option value="">Todas</option>
              {localizacoes.map((l, i) => (
                <option key={i} value={getOptionValue(l)}>{getOptionLabel(l)}</option>
              ))}
            </select>
          </div>
          <div className="filter-item">
            <label>Categoria</label>
            <select
              value={filters.categoria || ''}
              onChange={(e) => handleFilterChange('categoria', e.target.value)}
            >
              <option value="">Todas</option>
              {categorias.map((c, i) => (
                <option key={i} value={getOptionValue(c)}>{getOptionLabel(c)}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="info-grid info-grid-2">
        <div className="info-card">
          <h3>Total chamados</h3>
          <p className="metric-number">{summary.total_chamados}</p>
        </div>
        <div className="info-card">
          <h3>Fechados</h3>
          <p className="metric-number">{summary.chamados_fechados}</p>
        </div>
        <div className="info-card">
          <h3>Abertos</h3>
          <p className="metric-number">{summary.chamados_abertos}</p>
        </div>
        <div className="info-card">
          <h3>Técnicos</h3>
          <p className="metric-number">{summary.total_tecnicos}</p>
        </div>
      </section>

      <section className="content-card">
        <h3>Chamados</h3>
        {loading ? (
          <p>Carregando...</p>
        ) : (
          <div className="table-responsive">
            <table className="performance-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Título</th>
                  <th>Técnico</th>
                  <th>Grupo</th>
                  <th>Status</th>
                  <th>Data abertura</th>
                  <th>Data fechamento</th>
                </tr>
              </thead>
              <tbody>
                {(connected ? chamados.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : chamados).map((c, i) => (
                  <tr key={c.id ?? i}>
                    <td>{c.id}</td>
                    <td>{c.titulo}</td>
                    <td>{c.tecnico}</td>
                    <td>{c.grupo}</td>
                    <td>{c.status}</td>
                    <td>{c.data_abertura}</td>
                    <td>{c.data_fechamento}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && chamados.length === 0 && <p>Nenhum chamado encontrado.</p>}
        {loadingMore && (
          <p style={{ color: '#6b7280', fontSize: 14, marginTop: 8 }}>
            Carregando mais... ({streamProgress.progress} de {streamProgress.total} chamados processados)
          </p>
        )}
        {!loading && pagination.totalPages > 1 && (
          <div className="pagination">
            <span className="pagination-info">
              Página {pagination.page} de {pagination.totalPages} ({pagination.total} chamados)
            </span>
            <div className="pagination-buttons">
              <button
                type="button"
                onClick={() => handlePage(1)}
                disabled={page <= 1}
                title="Primeira"
              >
                «
              </button>
              <button
                type="button"
                onClick={() => handlePage(page - 1)}
                disabled={page <= 1}
                title="Anterior"
              >
                ‹
              </button>
              {Array.from({ length: Math.min(6, pagination.totalPages) }, (_, i) => {
                let p
                if (pagination.totalPages <= 6) {
                  p = i + 1
                } else if (page <= 3) {
                  p = i + 1
                } else if (page >= pagination.totalPages - 2) {
                  p = pagination.totalPages - 5 + i
                } else {
                  p = page - 2 + i
                }
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handlePage(p)}
                    className={page === p ? 'active' : ''}
                  >
                    {p}
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => handlePage(page + 1)}
                disabled={page >= pagination.totalPages}
                title="Próxima"
              >
                ›
              </button>
              <button
                type="button"
                onClick={() => handlePage(pagination.totalPages)}
                disabled={page >= pagination.totalPages}
                title="Última"
              >
                »
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  )
}
