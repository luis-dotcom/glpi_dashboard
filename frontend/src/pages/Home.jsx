import { useAuth } from '../context/AuthContext'
import './Pages.css'

export default function Home() {
  const { user } = useAuth()

  return (
    <>
      <section className="content-card">
        <h2>Bem-vindo ao sistema</h2>
        <p>Esta é a tela inicial.</p>
      </section>

      <section className="info-grid">
        <div className="info-card">
          <h3>Usuário</h3>
          <p>{user?.name || user?.username}</p>
        </div>
        <div className="info-card">
          <h3>Perfil GLPI</h3>
          <p>{user?.profile || 'Sem perfil'}</p>
        </div>
        <div className="info-card">
          <h3>Login</h3>
          <p>{user?.username}</p>
        </div>
      </section>
    </>
  )
}
