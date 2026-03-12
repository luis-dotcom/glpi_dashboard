import { useState, useEffect, useCallback } from 'react'
import { useWS } from '../context/WebSocketContext'
import { api } from '../api'
import './Pages.css'

const PAGE_SIZE = 20

// Cache para preservar dados ao navegar entre páginas (evita recarregar ao voltar)
const colaboradoresCache = { data: null, key: '' }

function getCacheKey(inicio, fim) {
  return `${inicio || ''}_${fim || ''}`
}

export default function Colaboradores() {
  const { send, sendStream, connected } = useWS()
  const [data, setData] = useState(() => {
    const key = getCacheKey('', '')
    return colaboradoresCache.key === key ? colaboradoresCache.data : null
  })
  const [loading, setLoading] = useState(() => {
    const key = getCacheKey('', '')
    return !(colaboradoresCache.data && colaboradoresCache.key === key)
  })
  const [loadingMore, setLoadingMore] = useState(false)
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(async (inicio, fim, forceRefresh = false) => {
    const cacheKey = getCacheKey(inicio, fim)
    if (!forceRefresh && colaboradoresCache.key === cacheKey && colaboradoresCache.data) {
      setData(colaboradoresCache.data)
      setLoading(false)
      setLoadingMore(false)
      return
    }

    setLoading(true)
    setData(null)
    try {
      if (connected) {
        const res = await sendStream(
          'get_colaboradores_stream',
          { data_inicio: inicio || undefined, data_fim: fim || undefined },
          (chunk) => {
            const partial = {
              ranking: chunk.ranking,
              total_count: chunk.total_count,
              data_inicio: chunk.data_inicio,
              data_fim: chunk.data_fim,
              progress: chunk.progress,
              total_users: chunk.total_users,
            }
            setData(partial)
            setLoading(false)
            setLoadingMore(chunk.progress < chunk.total_users)
          }
        )
        colaboradoresCache.data = res
        colaboradoresCache.key = cacheKey
        setData(res)
        setLoadingMore(false)
      } else {
        const res = await api.portal.colaboradores(inicio, fim)
        colaboradoresCache.data = res
        colaboradoresCache.key = cacheKey
        setData(res)
      }
    } catch (err) {
      const msg = err.name === 'AbortError' ? 'A requisição demorou muito. Tente filtrar por período menor.' : err.message
      setData({ ranking: [], error: msg })
    } finally {
      setLoading(false)
    }
  }, [connected, sendStream])

  useEffect(() => {
    load(dataInicio, dataFim)
  }, [load])

  const handleFiltrar = (e) => {
    e.preventDefault()
    setPage(1)
    load(dataInicio, dataFim, true)
  }

  const handlePage = (p) => {
    const totalPgs = Math.max(1, Math.ceil((data?.total_count || 0) / PAGE_SIZE))
    if (p >= 1 && p <= totalPgs) {
      setPage(p)
    }
  }

  const rankingFull = data?.ranking || []
  const totalCount = data?.total_count || 0
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const start = (page - 1) * PAGE_SIZE
  const ranking = rankingFull.slice(start, start + PAGE_SIZE)

  return (
    <>
      <div className="page-header-flex">
        <h2>Colaboradores</h2>
        <form className="period-filter-form" onSubmit={handleFiltrar}>
          <div>
            <label>Data início</label>
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
            />
          </div>
          <div>
            <label>Data fim</label>
            <input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
            />
          </div>
          <button type="submit">Filtrar</button>
        </form>
      </div>

      {loading ? (
        <div className="content-card">
          <p>Carregando ranking de colaboradores...</p>
          <p style={{ color: '#6b7280', fontSize: 14, marginTop: 8 }}>
            Isso pode levar alguns minutos (consulta muitos dados no GLPI).
          </p>
        </div>
      ) : data?.error ? (
        <div className="content-card">
          <div className="alert-error">{data.error}</div>
        </div>
      ) : (
        <section className="content-card">
          <h3>Ranking de colaboradores</h3>
          <div className="table-responsive">
            <table className="performance-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nome</th>
                  <th>Total</th>
                  <th>Atribuídos</th>
                  <th>Pendentes</th>
                  <th>Resolvidos</th>
                  <th>Fechados</th>
                  <th>Backlog</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((item, i) => (
                  <tr key={i}>
                    <td>{start + i + 1}</td>
                    <td>{item.nome}</td>
                    <td>{item.total}</td>
                    <td>{item.atribuidos}</td>
                    <td>{item.pendentes}</td>
                    <td>{item.resolvidos}</td>
                    <td>{item.fechados}</td>
                    <td>{item.backlog}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ranking.length === 0 && !loading && <p>Nenhum dado encontrado.</p>}

          {loadingMore && (
            <p style={{ color: '#6b7280', fontSize: 14, marginTop: 8 }}>
              Carregando mais... ({data?.progress ?? 0} de {data?.total_users ?? 0} usuarios processados)
            </p>
          )}
          {ranking.length > 0 && (
            <div className="pagination">
              <span className="pagination-info">
                Página {page} de {totalPages} ({totalCount} colaboradores)
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
                {Array.from({ length: Math.min(6, totalPages) }, (_, i) => {
                  let p
                  if (totalPages <= 6) {
                    p = i + 1
                  } else if (page <= 3) {
                    p = i + 1
                  } else if (page >= totalPages - 2) {
                    p = totalPages - 5 + i
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
                  disabled={page >= totalPages}
                  title="Próxima"
                >
                  ›
                </button>
                <button
                  type="button"
                  onClick={() => handlePage(totalPages)}
                  disabled={page >= totalPages}
                  title="Última"
                >
                  »
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  )
}
