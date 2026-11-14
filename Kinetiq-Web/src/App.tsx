
import { useState } from 'react'
import type { FormEvent } from 'react'
import KneeSession from './KneeSession'
import './App.css'

type Role = 'knee' | 'neck' | 'ot'

type Account = {
  username: string
  password: string
  role: Role
  name: string
}

const accounts: Account[] = [
  { username: 'knee.patient', password: '1234', role: 'knee', name: 'Alex Morgan' },
  { username: 'tbi.patient', password: '1234', role: 'neck', name: 'Jordan Taylor' },
  { username: 'ot.admin', password: '1234', role: 'ot', name: 'Dr. Sarah Bennett' },
]

function App() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [account, setAccount] = useState<Account | null>(null)
  const [error, setError] = useState('')

  function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const matchedAccount = accounts.find(
      (item) => item.username === username && item.password === password
    )

    if (!matchedAccount) {
      setError('Incorrect username or password. Please try again.')
      return
    }

    setError('')
    setAccount(matchedAccount)
  }

  function logout() {
    setAccount(null)
    setUsername('')
    setPassword('')
    setError('')
  }

  if (!account) {
    return (
      <main className="login-page">
        <div className="login-container">
          <Brand />

          <section className="login-card">
            <div className="welcome">
              <span className="eyebrow">REHABILITATION, REIMAGINED</span>
              <h2>Welcome back.</h2>
              <p>Sign in to continue your rehabilitation journey.</p>
            </div>

            <form onSubmit={handleLogin}>
              <label htmlFor="username">Username</label>
              <input
                id="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Enter your username"
                required
              />

              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                required
              />

              {error && <p className="error-message">{error}</p>}

              <button type="submit">
                Sign in <span>→</span>
              </button>
            </form>

            <div className="login-footer">
              <span>SECURE ACCESS</span>
              <span>© 2026 KINETIQ</span>
            </div>
          </section>

          <p className="support-text">
            Need assistance? Contact your occupational therapist.
          </p>
        </div>
      </main>
    )
  }

  if (account.role === 'knee') {
    return <PatientDashboard account={account} logout={logout} />
  }

  if (account.role === 'neck') {
    return <NeckDashboard account={account} logout={logout} />
  }

  return <OtDashboard account={account} logout={logout} />
}

function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <svg viewBox="0 0 100 100" fill="none">
          <path
            d="M50 10 C72 25 80 40 50 50 C20 60 28 75 50 90"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path
            d="M20 35 C35 15 65 15 80 35 C95 55 65 85 35 65"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <h1>kinetiq</h1>
      <p>INTELLIGENCE IN EVERY MOVEMENT</p>
    </div>
  )
}

function Header({
  name,
  role,
  logout,
}: {
  name: string
  role: string
  logout: () => void
}) {
  return (
    <header className="app-header">
      <div className="header-brand">
        <span className="mini-mark">k.</span>
        <span>kinetiq</span>
      </div>

      <div className="header-right">
        <span className="user-label">{name} · {role}</span>
        <button className="logout-button" onClick={logout}>
          Sign out
        </button>
      </div>
    </header>
  )
}

function PatientDashboard({
  account,
  logout,
}: {
  account: Account
  logout: () => void
}) {
  const [showSession, setShowSession] = useState(false)

  if (showSession) {
    return <KneeSession onBack={() => setShowSession(false)} />
  }

  return (
    <div className="dashboard">
      <Header name={account.name} role="Patient" logout={logout} />

      <main className="dashboard-content">
        <span className="eyebrow">YOUR REHABILITATION JOURNEY</span>
        <h2>Welcome, {account.name.split(' ')[0]}.</h2>

        <p className="dashboard-subtitle">
          Small movements. Meaningful progress.
        </p>

        <section className="program-card">
          <div>
            <span className="eyebrow">YOUR ACTIVE PROGRAM</span>
            <h3>Knee Rehabilitation</h3>
            <p>Your personalized exercise program is ready.</p>
          </div>
        </section>

        <h3 className="section-heading">Today's exercises</h3>

        <div className="exercise-list">
          <div className="exercise-row">
            <div>
              <strong>Standing Knee Raises</strong>
              <p>2 sets × 10 repetitions</p>
            </div>
          </div>

          <div className="exercise-row">
            <div>
              <strong>Clamshells</strong>
              <p>2 sets × 10 repetitions · Green band</p>
            </div>
          </div>

          <div className="exercise-row">
            <div>
              <strong>Seated Knee Extensions</strong>
              <p>2 sets × 10 repetitions</p>
            </div>
          </div>
        </div>

        <button
          className="primary-action"
          onClick={() => setShowSession(true)}
        >
          Launch exercise session →
        </button>

        <p className="demo-note">
          Demonstration program · Follow your therapist's instructions.
        </p>
      </main>
    </div>
  )
}

function NeckDashboard({
  account,
  logout,
}: {
  account: Account
  logout: () => void
}) {
  return (
    <div className="dashboard">
      <Header name={account.name} role="Patient" logout={logout} />

      <main className="dashboard-content">
        <span className="eyebrow">YOUR REHABILITATION JOURNEY</span>
        <h2>Welcome, {account.name.split(' ')[0]}.</h2>

        <p className="dashboard-subtitle">
          Move comfortably. Build confidence. Track your progress.
        </p>

        <section className="program-card">
          <div>
            <span className="eyebrow">YOUR ACTIVE PROGRAM</span>
            <h3>Neck Rehabilitation</h3>
            <p>Your personalized cervical mobility program.</p>
          </div>
        </section>

        <h3 className="section-heading">Today's exercises</h3>

        <div className="exercise-list">
          <div className="exercise-row">
            <div>
              <strong>Gentle Neck Rotation</strong>
              <p>Therapist-assigned repetitions</p>
            </div>
          </div>

          <div className="exercise-row">
            <div>
              <strong>Neck Side Bends</strong>
              <p>Therapist-assigned repetitions</p>
            </div>
          </div>

          <div className="exercise-row">
            <div>
              <strong>Neck Flexion and Extension</strong>
              <p>Therapist-assigned repetitions</p>
            </div>
          </div>
        </div>

        <button className="primary-action">
          Neck session coming soon
        </button>

        <p className="demo-note">
          Demonstration program · Perform only exercises assigned by your therapist.
        </p>
      </main>
    </div>
  )
}

function OtDashboard({
  account,
  logout,
}: {
  account: Account
  logout: () => void
}) {
  return (
    <div className="dashboard ot-dashboard">
      <Header
        name={account.name}
        role="Occupational Therapist"
        logout={logout}
      />

      <main className="dashboard-content ot-content">
        <span className="eyebrow">CLINICAL WORKSPACE</span>
        <h2>Good evening, Sarah.</h2>

        <p className="dashboard-subtitle">
          Your patient overview and rehabilitation workspace.
        </p>

        <div className="stats-grid">
          <div className="stat-card">
            <span>DEMO PATIENTS</span>
            <strong>02</strong>
          </div>

          <div className="stat-card">
            <span>ACTIVE PROGRAMS</span>
            <strong>02</strong>
          </div>

          <div className="stat-card">
            <span>REPORTS</span>
            <strong>00</strong>
          </div>
        </div>

        <div className="ot-section-header">
          <div>
            <span className="eyebrow">PATIENT MANAGEMENT</span>
            <h3>My patients</h3>
          </div>

          <button className="secondary-action">
            + Add patient
          </button>
        </div>

        <div className="patient-list">
          <div className="patient-card">
            <div className="patient-avatar">AM</div>

            <div className="patient-info">
              <strong>Alex Morgan</strong>
              <span>Knee rehabilitation</span>
              <small>Active treatment plan</small>
            </div>

            <span className="status-label">Active</span>
          </div>

          <div className="patient-card">
            <div className="patient-avatar">JT</div>

            <div className="patient-info">
              <strong>Jordan Taylor</strong>
              <span>Neck rehabilitation</span>
              <small>Active treatment plan</small>
            </div>

            <span className="status-label">Active</span>
          </div>
        </div>

        <div className="ot-section-header">
          <div>
            <span className="eyebrow">WORKSPACE</span>
            <h3>Clinical tools</h3>
          </div>
        </div>

        <div className="tools-grid">
          <div className="tool-card">
            <strong>Treatment plans</strong>
            <p>Create and assign patient exercises.</p>
          </div>

          <div className="tool-card">
            <strong>Session reports</strong>
            <p>Review recorded rehabilitation sessions.</p>
          </div>

          <div className="tool-card">
            <strong>Patient profiles</strong>
            <p>Manage patient information and goals.</p>
          </div>

          <div className="tool-card">
            <strong>Progress overview</strong>
            <p>Monitor activity over time.</p>
          </div>
        </div>

        <p className="demo-note">
          Fictional demonstration data · Not for clinical decision-making.
        </p>
      </main>
    </div>
  )
}

export default App
