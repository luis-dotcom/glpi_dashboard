import { useState, useEffect, useCallback } from 'react'
import { useWS } from '../context/WebSocketContext'
import { api } from '../api'
import './Pages.css'

const desempenhoCache = { data: null, key: '' }

function getCacheKey(ano) {
  return String(ano)
}

export default function Desempenho() {
  const { send, sendStream, connected } = useWS()
  const [data, setData] = useState(() => {
    const key = getCacheKey(new Date().getFullYear())
    return desempenhoCache.key === key ? desempenhoCache.data : null
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(() => {
    const key = getCacheKey(new Date().getFullYear())
    return !(desempenhoCache.data && desempenhoCache.key === key)
  })
  const [loadingMore, setLoadingMore] = useState(false)
  const [ano, setAno] = useState(new Date().getFullYear())

  const load = useCallback(async (anoVal, forceRefresh = false) => {
    const cacheKey = getCacheKey(anoVal)
    if (!forceRefresh && desempenhoCache.key === cacheKey && desempenhoCache.data) {
      setData(desempenhoCache.data)
      setLoading(false)
      setLoadingMore(false)
      setError('')
      return
    }

    setLoading(true)
    setError('')
    setLoadingMore(false)
    try {
      if (connected) {
        const res = await sendStream(
            'get_desempenho_stream',
            { ano: anoVal },
            (chunk) => {
              setData(chunk)
              setLoading(false)
              setLoadingMore(
                chunk.progress != null &&
                chunk.total_tickets != null &&
                chunk.progress < chunk.total_tickets
              )
            }
          )
          desempenhoCache.data = res
          desempenhoCache.key = cacheKey
          setData(res)
          setLoadingMore(false)
        } else {
          const res = await api.portal.desempenho(anoVal)
          desempenhoCache.data = res
          desempenhoCache.key = cacheKey
          setData(res)
        }
    } catch (err) {
      setError(err.message)
      setData(null)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [connected, sendStream])

  useEffect(() => {
    load(ano)
  }, [ano, load])

  const anos = data?.available_years || Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)

  if (loading && !data) {
    return (
      <div className="content-card">
        <p>Carregando desempenho...</p>
        <p style={{ color: '#6b7280', fontSize: 14, marginTop: 8 }}>
          Isso pode levar alguns minutos (consulta muitos dados no GLPI).
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="content-card">
        <div className="alert-error">{error}</div>
      </div>
    )
  }

  return (
    <>
      <div className="page-header-flex">
        <h2>Desempenho</h2>
        <div className="year-filter-form">
          <label>Ano</label>
          <select value={ano} onChange={(e) => setAno(Number(e.target.value))}>
            {anos.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      <section className="info-grid info-grid-2">
        <div className="info-card">
          <h3>Total atribuídos (ano)</h3>
          <p className="metric-number">{data?.assigned_year_total ?? 0}</p>
        </div>
        <div className="info-card">
          <h3>Pendentes</h3>
          <p className="metric-number">{data?.pending_total ?? 0}</p>
        </div>
        <div className="info-card">
          <h3>Resolvidos no ano</h3>
          <p className="metric-number">{data?.total_resolved_year ?? 0}</p>
        </div>
        <div className="info-card">
          <h3>Backlog atual</h3>
          <p className="metric-number">{data?.current_backlog ?? 0}</p>
        </div>
      </section>

      {loadingMore && (
        <p style={{ color: '#6b7280', fontSize: 14, marginTop: 8 }}>
          Carregando mais... ({data?.progress ?? 0} de {data?.total_tickets ?? 0} tickets processados)
        </p>
      )}
      {data?.history_rows?.length > 0 && (
        <section className="content-card">
          <h3>Histórico mensal</h3>
          <div className="table-responsive">
            <table className="performance-table">
              <thead>
                <tr>
                  <th>Mês</th>
                  <th>Capturados</th>
                  <th>Resolvidos</th>
                  <th>Backlog</th>
                  <th>Taxa resolução %</th>
                </tr>
              </thead>
              <tbody>
                {data.history_rows.map((row, i) => (
                  <tr key={i}>
                    <td>{row.mes}</td>
                    <td>{row.capturados}</td>
                    <td>{row.resolvidos}</td>
                    <td>{row.backlog}</td>
                    <td>{row.taxa_resolucao}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}
