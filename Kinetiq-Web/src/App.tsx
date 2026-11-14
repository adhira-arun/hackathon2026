
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import KneeSession, { type KneeSessionReport } from './KneeSession'
import StandingKneeSession from './StandingKneeSession'
import NeckSideBends, { type NeckSessionReport } from './NeckSideBends'
import NeckExtension from './NeckExtension'
import './App.css'
import { fetchReports } from './api'
import ReportReviewPanel from './ReportReviewPanel'

type SessionReport = KneeSessionReport | NeckSessionReport

type Role = 'knee' | 'neck' | 'ot'
type Account = { username: string; password: string; role: Role; name: string }

const accounts: Account[] = [
  { username: 'knee.patient', password: '1234', role: 'knee', name: 'Knee Baby' },
  { username: 'neck.patient', password: '1234', role: 'neck', name: 'Neck Baby' },
  { username: 'ot.admin', password: '1234', role: 'ot', name: 'Dr. Who' },
]

const REPORTS_KEY = 'kinetiq.sessionReports'
const REST_SETTING_KEY = 'kinetiq.ot.restSeconds'
const patientRestKey = (username: string) => `kinetiq.ot.restSeconds.${username}`
const DEFAULT_REST_SECONDS = 45

function readPatientRestSeconds(username: string) {
  const stored = Number(localStorage.getItem(patientRestKey(username)))
  return Number.isFinite(stored) && stored >= 5 && stored <= 300
    ? stored
    : DEFAULT_REST_SECONDS
}

function readReports(): SessionReport[] {
  try {
    return JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]') as SessionReport[]
  } catch {
    return []
  }
}


const WEEKLY_CHECKLIST_KEY = 'kinetiq.weeklyChecklist'
const NECK_WEEKLY_CHECKLIST_KEY = 'kinetiq.neckWeeklyChecklist'
const DEMO_COMPLETED_WEEK = '2026-11-08'

const WEEKLY_EXERCISES = [
  { day: 'Sunday', exercise: 'Seated Knee Extensions', type: 'tracked' },
  { day: 'Monday', exercise: 'Standing Knee Raises', type: 'tracked' },
  { day: 'Tuesday', exercise: 'Seated Knee Extensions', type: 'tracked' },
  { day: 'Wednesday', exercise: 'Standing Knee Raises', type: 'tracked' },
  { day: 'Thursday', exercise: 'Seated Knee Extensions', type: 'tracked' },
  { day: 'Friday', exercise: 'Standing Knee Raises', type: 'tracked' },
  { day: 'Saturday', exercise: 'Seated Knee Extensions', type: 'tracked' },
] as const

function localDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getWeekDates(today: Date) {
  const sunday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - today.getDay()
  )

  return WEEKLY_EXERCISES.map((_, index) => {
    const date = new Date(sunday)
    date.setDate(sunday.getDate() + index)
    return date
  })
}

function readWeeklyChecklist(weekKey: string, storageKey = WEEKLY_CHECKLIST_KEY): number[] {
  try {
    const saved = JSON.parse(
      localStorage.getItem(storageKey) || '{}'
    )
    return saved[weekKey] || []
  } catch {
    return []
  }
}

function saveCompletedDay(weekKey: string, dayIndex: number, storageKey = WEEKLY_CHECKLIST_KEY) {
  try {
    const saved = JSON.parse(
      localStorage.getItem(storageKey) || '{}'
    )
    const completed: number[] = saved[weekKey] || []

    if (!completed.includes(dayIndex)) completed.push(dayIndex)

    saved[weekKey] = completed
    localStorage.setItem(storageKey, JSON.stringify(saved))
  } catch {
    console.error('Could not save weekly checklist.')
  }
}

function App() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [account, setAccount] = useState<Account | null>(null)
  const [error, setError] = useState('')
  const [reports, setReports] = useState<SessionReport[]>(readReports)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('kinetiq.theme')
    return saved === 'dark' ? 'dark' : 'light'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('kinetiq.theme', theme)
  }, [theme])

  function toggleTheme() {
    setTheme((current) => current === 'light' ? 'dark' : 'light')
  }

  async function refreshReports() {
    const local = readReports()
    try {
      const server = await fetchReports<SessionReport>()
      const serverIds = new Set(server.map((r) => r.id))
      setReports([...server, ...local.filter((r) => !serverIds.has(r.id))])
    } catch {
      setReports(local)
    }
  }

  function handleLogin(event: FormEvent<HTMLFormElement>) {
  event.preventDefault()

  const normalizedUsername = username.trim().toLowerCase()

  const matched = accounts.find(
    (item) =>
      item.username.toLowerCase() === normalizedUsername &&
      item.password === password
  )

  if (!matched) {
    setError('Incorrect username or password. Please try again.')
    return
  }

  setError('')
  setAccount(matched)

  if (matched.role === 'knee' || matched.role === 'neck') {
    // Session components read the active rest duration from this shared key.
    // Load the signed-in patient's own therapist setting before the session starts.
    localStorage.setItem(
      REST_SETTING_KEY,
      String(readPatientRestSeconds(matched.username))
    )
  }

  if (matched.role === 'ot') {
    void refreshReports()
  }
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
          <div className="login-theme-row">
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              aria-pressed={theme === 'dark'}
            >
              <span aria-hidden="true">{theme === 'light' ? '🌙' : '☀️'}</span>
              {theme === 'light' ? 'Dark mode' : 'Light mode'}
            </button>
          </div>
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
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                required
              />
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
              />
              {error && <p className="error-message" role="alert">{error}</p>}
              <button type="submit">Sign in <span>→</span></button>
            </form>
            <div className="login-footer">
              <span>DEMO ACCESS</span>
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
    return (
      <PatientDashboard
        account={account}
        logout={logout}
        theme={theme}
        toggleTheme={toggleTheme}
        onReport={(report) => setReports((old) => [...old, report])}
      />
    )
  }

  if (account.role === 'neck') {
    return (
      <NeckDashboard
        account={account}
        logout={logout}
        theme={theme}
        toggleTheme={toggleTheme}
        onReport={(report) => setReports((old) => [...old, report])}
      />
    )
  }

  return (
    <OtDashboard
      account={account}
      logout={logout}
      reports={reports}
 theme={theme}
      toggleTheme={toggleTheme}
      onReportsRefresh={refreshReports}
    />
  )
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
  theme,
  toggleTheme,
}: {
  name: string
  role: string
  logout: () => void
  theme: 'light' | 'dark'
  toggleTheme: () => void
}) {
  return (
    <header className="app-header">
      <div className="header-brand">
        <span className="mini-mark">k.</span>
        <span>kinetiq</span>
      </div>
      <div className="header-right">
        <span className="user-label">{name} · {role}</span>
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          aria-pressed={theme === 'dark'}
        >
          <span aria-hidden="true">{theme === 'light' ? '🌙' : '☀️'}</span>
          {theme === 'light' ? 'Dark mode' : 'Light mode'}
        </button>
        <button className="logout-button" onClick={logout}>Sign out</button>
      </div>
    </header>
  )
}

function PatientDashboard({
  account,
  logout,
  theme,
  toggleTheme,
  onReport,
}: {
  account: Account
  logout: () => void
  theme: 'light' | 'dark'
  toggleTheme: () => void
  onReport: (report: KneeSessionReport) => void
}) {
  const [showSession, setShowSession] = useState(false)
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [today, setToday] = useState(() => new Date())
  const [completedDays, setCompletedDays] = useState<number[]>([])

  const weekDates = getWeekDates(today)
  const weekKey = localDateKey(weekDates[0])

  useEffect(() => {
    const savedDays = readWeeklyChecklist(weekKey)

    // Demo setup: show Nov 8–13, 2026 as already completed.
    const initialDays =
      weekKey === DEMO_COMPLETED_WEEK
        ? Array.from(new Set([...savedDays, 0, 1, 2, 3, 4, 5]))
        : savedDays

    if (weekKey === DEMO_COMPLETED_WEEK) {
      try {
        const saved = JSON.parse(
          localStorage.getItem(WEEKLY_CHECKLIST_KEY) || '{}'
        )
        saved[weekKey] = initialDays
        localStorage.setItem(WEEKLY_CHECKLIST_KEY, JSON.stringify(saved))
      } catch {
        console.error('Could not initialize demo checklist.')
      }
    }

    setCompletedDays(initialDays)
  }, [weekKey])

  useEffect(() => {
    const interval = window.setInterval(() => setToday(new Date()), 30000)
    return () => window.clearInterval(interval)
  }, [])

  function completeDay(dayIndex: number) {
    saveCompletedDay(weekKey, dayIndex)
    setCompletedDays((previous) =>
      previous.includes(dayIndex) ? previous : [...previous, dayIndex]
    )
    setSelectedDay(null)
  }

  function handleSessionComplete(report: KneeSessionReport) {
    onReport(report)
    if (report.status === 'completed' && selectedDay !== null) {
      completeDay(selectedDay)
    }
  }

  if (showSession) {
    const isStanding =
      selectedDay !== null &&
      WEEKLY_EXERCISES[selectedDay].exercise === 'Standing Knee Raises'

    return isStanding ? (
      <StandingKneeSession
        onBack={() => setShowSession(false)}
        onComplete={handleSessionComplete}
      />
    ) : (
      <KneeSession
        onBack={() => setShowSession(false)}
        onComplete={handleSessionComplete}
      />
    )
  }

  const selectedExercise =
    selectedDay !== null ? WEEKLY_EXERCISES[selectedDay] : null

  if (selectedExercise && selectedDay !== null) {
    return (
      <div className="dashboard">
        <Header name={account.name} role="Patient" logout={logout} theme={theme} toggleTheme={toggleTheme} />
        <main className="dashboard-content">
          <button className="back-link" onClick={() => setSelectedDay(null)}>
            ← Back to weekly plan
          </button>

          <span className="eyebrow">
            {selectedExercise.day.toUpperCase()} · KNEE EXERCISE
          </span>
          <h2>{selectedExercise.exercise}</h2>

          <section className="program-card">
            <div>
              <span className="eyebrow">YOUR EXERCISE</span>
              <h3>2 sets of 10</h3>
              <p>Follow the steps from your therapist.</p>
            </div>
          </section>

          {selectedExercise.type === 'tracked' ? (
            <>
              <button
                className="primary-action"
                onClick={() => setShowSession(true)}
              >
                {completedDays.includes(selectedDay) ? 'Replay' : 'Start'}
              </button>
            </>
          ) : (
            <>
              <div className="exercise-row">
                <strong>Standing knee raises</strong>
                <p>
                  Stand in a stable position and perform the exercise according
                  to your therapist's instructions.
                </p>
                <p>Complete 2 sets of 10 repetitions.</p>
              </div>
              <p className="demo-note">
                Manual completion for this demonstration. Camera tracking for
                standing knee raises has not been implemented yet.
              </p>
              <button
                className="primary-action"
                onClick={() => completeDay(selectedDay)}
              >
                {completedDays.includes(selectedDay)
                  ? 'Return to weekly plan →'
                  : 'Mark exercise complete →'}
              </button>
            </>
          )}

          {completedDays.includes(selectedDay) && (
            <p className="completion-message">
              <span>✓</span> This day is marked completed. You can reopen it
              for demonstration purposes.
            </p>
          )}
        </main>
      </div>
    )
  }

  const completedCount = completedDays.length
  const progress = (completedCount / 7) * 100

  return (
    <div className="dashboard">
      <Header name={account.name} role="Patient" logout={logout} theme={theme} toggleTheme={toggleTheme} />
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
            <p>Your personalized weekly exercise plan is ready.</p>
          </div>
        </section>

        <section className="weekly-progress-card">
          <div className="weekly-progress-heading">
            <div>
              <span className="eyebrow">WEEKLY ACTIVITY</span>
              <h3>Your weekly progress</h3>
            </div>
            <strong>{completedCount}/7</strong>
          </div>
          <div
            className="weekly-progress-track"
            role="progressbar"
            aria-label="Weekly exercise progress"
            aria-valuenow={completedCount}
            aria-valuemin={0}
            aria-valuemax={7}
          >
            <div style={{ width: `${progress}%` }} />
          </div>
          <p>{completedCount} of 7 days completed this week.</p>
        </section>

        <div className="weekly-plan-heading">
          <div>
            <span className="eyebrow">SUNDAY – SATURDAY</span>
            <h3 className="section-heading">Your weekly exercises</h3>
          </div>
        </div>

        <div className="weekly-checklist">
          {WEEKLY_EXERCISES.map((item, index) => {
            const date = weekDates[index]
            const isCompleted = completedDays.includes(index)
            const isToday = localDateKey(date) === localDateKey(today)
            const isFuture =
              date >
              new Date(today.getFullYear(), today.getMonth(), today.getDate())

            const availabilityLabel = isFuture
              ? `Available ${item.day} at 12:00 AM`
              : isToday
                ? 'Available today'
                : 'Available'

            return (
              <button
                key={item.day}
                className={`weekly-day-card ${
                  isCompleted ? 'completed' : ''
                } ${isFuture ? 'future-day' : ''} ${
                  isToday ? 'current-day' : ''
                }`}
                onClick={() => setSelectedDay(index)}
                aria-label={`${item.day}: ${item.exercise}. ${
                  isCompleted
                    ? 'Completed. Click to replay demo.'
                    : isFuture
                      ? `${availabilityLabel}. Demo access enabled.`
                      : availabilityLabel
                }`}
              >
                <div className="weekly-day-name">
                  <span>{item.day.slice(0, 3)}</span>
                  <small>
                    {date.toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </small>
                </div>

                <div className="weekly-day-info">
                  <strong>{item.exercise}</strong>
                  <small>2 sets × 10 reps</small>
                  <span className={`weekly-day-status-label ${isCompleted ? 'is-completed' : isToday ? 'is-today' : ''}`}>
                    {isCompleted
                      ? 'Completed'
                      : isToday
                        ? 'Ready to start'
                        : isFuture
                          ? 'Coming up'
                          : 'Available'}
                  </span>
                  {isCompleted && (
                    <span className="weekly-day-replay">Demo replay available</span>
                  )}
                </div>

                <div className="weekly-day-indicator">
                  {isCompleted ? (
                    <span className="weekly-lock-symbol" aria-label="Completed and locked">🔒</span>
                  ) : isFuture ? (
                    <span className="weekly-lock">◷</span>
                  ) : (
                    <span className="weekly-open">→</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        <p className="demo-note">
          November 8–13 are marked completed for this demonstration. Completed
          days show a lock icon and remain clickable for demo replay.
        </p>
        <p className="demo-note">
          Follow your occupational therapist's prescribed exercise plan.
        </p>
      </main>
    </div>
  )
}

function NeckDashboard({
  account,
  logout,
  theme,
  toggleTheme,
  onReport,
}: {
  account: Account
  logout: () => void
  theme: 'light' | 'dark'
  toggleTheme: () => void
  onReport: (report: NeckSessionReport) => void
}) {
  const [showSession, setShowSession] = useState(false)
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [today, setToday] = useState(() => new Date())
  const [completedDays, setCompletedDays] = useState<number[]>([])

  // The neck checklist is stored separately so knee and neck progress never overlap.
  const weekDates = getWeekDates(today)
  const weekKey = localDateKey(weekDates[0])
  const neckExercises = [
    { day: 'Sunday', exercise: 'Neck Side Bends', id: 'side-bends' },
    { day: 'Monday', exercise: 'Neck Flexion and Extension', id: 'extension' },
    { day: 'Tuesday', exercise: 'Neck Side Bends', id: 'side-bends' },
    { day: 'Wednesday', exercise: 'Neck Flexion and Extension', id: 'extension' },
    { day: 'Thursday', exercise: 'Neck Side Bends', id: 'side-bends' },
    { day: 'Friday', exercise: 'Neck Flexion and Extension', id: 'extension' },
    { day: 'Saturday', exercise: 'Neck Side Bends', id: 'side-bends' },
  ] as const

  useEffect(() => {
    const savedDays = readWeeklyChecklist(weekKey, NECK_WEEKLY_CHECKLIST_KEY)
    const initialDays = weekKey === DEMO_COMPLETED_WEEK
      ? Array.from(new Set([...savedDays, 0, 1, 2, 3, 4, 5]))
      : savedDays

    if (weekKey === DEMO_COMPLETED_WEEK) {
      try {
        const saved = JSON.parse(localStorage.getItem(NECK_WEEKLY_CHECKLIST_KEY) || '{}')
        saved[weekKey] = initialDays
        localStorage.setItem(NECK_WEEKLY_CHECKLIST_KEY, JSON.stringify(saved))
      } catch {
        console.error('Could not initialize neck demo checklist.')
      }
    }

    setCompletedDays(initialDays)
  }, [weekKey])

  useEffect(() => {
    const interval = window.setInterval(() => setToday(new Date()), 30000)
    return () => window.clearInterval(interval)
  }, [])

  function completeDay(dayIndex: number) {
    saveCompletedDay(weekKey, dayIndex, NECK_WEEKLY_CHECKLIST_KEY)
    setCompletedDays((previous) =>
      previous.includes(dayIndex) ? previous : [...previous, dayIndex]
    )
    setSelectedDay(null)
  }

  function handleSessionComplete(report: NeckSessionReport) {
    onReport(report)
    if (report.status === 'completed' && selectedDay !== null) {
      completeDay(selectedDay)
    }
  }

  if (showSession && selectedDay !== null) {
    const selected = neckExercises[selectedDay]
    return selected.id === 'side-bends' ? (
      <NeckSideBends
        onBack={() => setShowSession(false)}
        onComplete={handleSessionComplete}
      />
    ) : (
      <NeckExtension
        onBack={() => setShowSession(false)}
        onComplete={handleSessionComplete}
      />
    )
  }

  const selectedExercise = selectedDay !== null ? neckExercises[selectedDay] : null

  if (selectedExercise && selectedDay !== null) {
    return (
      <div className="dashboard">
        <Header name={account.name} role="Patient" logout={logout} theme={theme} toggleTheme={toggleTheme} />
        <main className="dashboard-content">
          <button className="back-link" onClick={() => setSelectedDay(null)}>
            ← Back to weekly plan
          </button>
          <span className="eyebrow">{selectedExercise.day.toUpperCase()} · NECK EXERCISE</span>
          <h2>{selectedExercise.exercise}</h2>
          <section className="program-card">
            <div>
              <span className="eyebrow">YOUR EXERCISE</span>
              <h3>2 sets of 10</h3>
              <p>Follow the steps from your therapist.</p>
            </div>
          </section>
          <button className="primary-action" onClick={() => setShowSession(true)}>
            {completedDays.includes(selectedDay) ? 'Replay exercise' : 'Start exercise'}
          </button>
          {completedDays.includes(selectedDay) && (
            <p className="completion-message">
              <span>✓</span> This day is marked completed. You can reopen it for demonstration purposes.
            </p>
          )}
        </main>
      </div>
    )
  }

  const completedCount = completedDays.length
  const progress = (completedCount / 7) * 100

  return (
    <div className="dashboard">
      <Header name={account.name} role="Patient" logout={logout} theme={theme} toggleTheme={toggleTheme} />
      <main className="dashboard-content">
        <span className="eyebrow">YOUR REHABILITATION JOURNEY</span>
        <h2>Welcome, {account.name.split(' ')[0]}.</h2>
        <p className="dashboard-subtitle">Move comfortably. Build confidence. Track your progress.</p>

        <section className="program-card">
          <div>
            <span className="eyebrow">YOUR ACTIVE PROGRAM</span>
            <h3>Neck Rehabilitation</h3>
            <p>Your personalized cervical mobility program.</p>
          </div>
        </section>

        <section className="weekly-progress-card">
          <div className="weekly-progress-heading">
            <div>
              <span className="eyebrow">WEEKLY ACTIVITY</span>
              <h3>Your weekly progress</h3>
            </div>
            <strong>{completedCount}/7</strong>
          </div>
          <div
            className="weekly-progress-track"
            role="progressbar"
            aria-label="Weekly neck exercise progress"
            aria-valuenow={completedCount}
            aria-valuemin={0}
            aria-valuemax={7}
          >
            <div style={{ width: `${progress}%` }} />
          </div>
          <p>{completedCount} of 7 days completed this week.</p>
        </section>

        <div className="weekly-plan-heading">
          <div>
            <span className="eyebrow">SUNDAY – SATURDAY</span>
            <h3 className="section-heading">Your weekly exercises</h3>
          </div>
        </div>

        <div className="weekly-checklist">
          {neckExercises.map((item, index) => {
            const date = weekDates[index]
            const isCompleted = completedDays.includes(index)
            const isToday = localDateKey(date) === localDateKey(today)
            const isFuture = date > new Date(today.getFullYear(), today.getMonth(), today.getDate())
            const availabilityLabel = isFuture
              ? `Available ${item.day} at 12:00 AM`
              : isToday ? 'Available today' : 'Available'

            return (
              <button
                key={item.day}
                className={`weekly-day-card ${isCompleted ? 'completed' : ''} ${isFuture ? 'future-day' : ''} ${isToday ? 'current-day' : ''}`}
                onClick={() => setSelectedDay(index)}
                aria-label={`${item.day}: ${item.exercise}. ${isCompleted ? 'Completed. Click to replay.' : availabilityLabel}`}
              >
                <div className="weekly-day-name">
                  <span>{item.day.slice(0, 3)}</span>
                  <small>{date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small>
                </div>
                <div className="weekly-day-info">
                  <strong>{item.exercise}</strong>
                  <small>2 sets × 10 reps</small>
                  <span className={`weekly-day-status-label ${isCompleted ? 'is-completed' : isToday ? 'is-today' : ''}`}>
                    {isCompleted ? 'Completed' : isToday ? 'Ready to start' : isFuture ? 'Coming up' : 'Available'}
                  </span>
                  {isCompleted && <span className="weekly-day-replay">Demo replay available</span>}
                </div>
                <div className="weekly-day-indicator">
                  {isCompleted ? (
                    <span className="weekly-lock-symbol" aria-label="Completed and locked">🔒</span>
                  ) : isFuture ? (
                    <span className="weekly-lock">◷</span>
                  ) : (
                    <span className="weekly-open">→</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        <p className="demo-note">
          November 8–13 are marked completed for this demonstration. Completed days show a lock icon and remain clickable for demo replay.
        </p>
        <p className="demo-note">Follow your occupational therapist's prescribed exercise plan.</p>
      </main>
    </div>
  )
}

/* Visualizes the recorded peak angle for each repetition. */
function AngleProgressChart({
  sets,
}: {
  sets: KneeSessionReport['sets']
}) {
  const chartSets = sets
    .filter((set) => set.angles.length > 0)
    .map((set) => ({
      setNumber: set.setNumber,
      angles: set.angles.slice(0, set.targetRepetitions),
    }))

  const allAngles = chartSets.flatMap((set) => set.angles)

  if (allAngles.length === 0) {
    return (
      <div className="angle-chart-empty">
        No repetition angle data is available for this session.
      </div>
    )
  }

  const rawMin = Math.min(...allAngles)
  const rawMax = Math.max(...allAngles)
  const minAngle = Math.floor(rawMin / 10) * 10
  const maxAngle = Math.max(
    minAngle + 20,
    Math.ceil(rawMax / 10) * 10
  )

  const chartLeft = 58
  const chartRight = 690
  const chartTop = 24
  const chartBottom = 190
  const xPosition = (rep: number) =>
    chartLeft + ((rep - 1) / 19) * (chartRight - chartLeft)
  const yPosition = (angle: number) =>
    chartBottom -
    ((angle - minAngle) / (maxAngle - minAngle)) *
      (chartBottom - chartTop)

  const yTicks = Array.from(
    { length: 5 },
    (_, index) => minAngle + ((maxAngle - minAngle) / 4) * index
  )

  const xTicks = [1, 5, 10, 11, 15, 20]

  return (
    <div className="angle-chart">
      <div className="angle-chart-legend">
        {chartSets.map((set) => (
          <span key={set.setNumber}>
            <i className={`chart-legend-dot set-${set.setNumber}`} />
            Set {set.setNumber}
          </span>
        ))}
      </div>

      <div className="angle-chart-scroll">
        <svg
          className="angle-chart-svg"
          viewBox="0 0 720 240"
          role="img"
          aria-label="Line chart of recorded peak movement angles across repetitions"
        >
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={chartLeft}
                y1={yPosition(tick)}
                x2={chartRight}
                y2={yPosition(tick)}
                className="chart-grid-line"
              />
              <text
                x={chartLeft - 10}
                y={yPosition(tick) + 4}
                textAnchor="end"
                className="chart-axis-label"
              >
                {Math.round(tick)}°
              </text>
            </g>
          ))}

          <line
            x1={chartLeft}
            y1={chartBottom}
            x2={chartRight}
            y2={chartBottom}
            className="chart-axis-line"
          />

          {xTicks.map((tick) => (
            <text
              key={tick}
              x={xPosition(tick)}
              y="215"
              textAnchor="middle"
              className="chart-axis-label"
            >
              {tick}
            </text>
          ))}

          {chartSets.map((set) => {
            const points = set.angles.map((angle, index) => ({
              angle,
              rep: (set.setNumber - 1) * 10 + index + 1,
            }))

            const path = points
              .map((point, index) =>
                `${index === 0 ? 'M' : 'L'} ${xPosition(point.rep)} ${yPosition(point.angle)}`
              )
              .join(' ')

            return (
              <g key={set.setNumber}>
                <path
                  d={path}
                  className={`chart-line set-${set.setNumber}`}
                />
                {points.map((point) => (
                  <circle
                    key={point.rep}
                    cx={xPosition(point.rep)}
                    cy={yPosition(point.angle)}
                    r="4.5"
                    className={`chart-point set-${set.setNumber}`}
                  >
                    <title>
                      Set {set.setNumber}, repetition {point.rep}, {point.angle}°
                    </title>
                  </circle>
                ))}
              </g>
            )
          })}
        </svg>
      </div>

      <p className="angle-chart-caption">
        Repetition number · Recorded peak movement angle in degrees
      </p>
    </div>
  )
}

function NeckReportDetail({ report }: { report: NeckSessionReport }) {
  const metrics = report.movementMetrics || {}
  const leftValues = Array.isArray(metrics.leftTiltDegrees)
    ? metrics.leftTiltDegrees as number[]
    : []
  const rightValues = Array.isArray(metrics.rightTiltDegrees)
    ? metrics.rightTiltDegrees as number[]
    : []
  const flexionValues = Array.isArray(metrics.flexionMovementProxy)
    ? metrics.flexionMovementProxy as number[]
    : []
  const extensionValues = Array.isArray(metrics.extensionMovementProxy)
    ? metrics.extensionMovementProxy as number[]
    : []
  const isSideBend = report.exercise.toLowerCase().includes('side bend')
  const primaryValues = isSideBend ? leftValues : flexionValues
  const secondaryValues = isSideBend ? rightValues : extensionValues
  const primaryLabel = isSideBend ? 'Left tilt' : 'Flexion'
  const secondaryLabel = isSideBend ? 'Right tilt' : 'Extension'
  const allValues = [...primaryValues, ...secondaryValues].filter(
    (value) => Number.isFinite(value) && value >= 0 && value <= 90
  )
  const average = (values: number[]) =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null
  const primaryAverage = average(primaryValues.filter((v) => Number.isFinite(v) && v >= 0 && v <= 90))
  const secondaryAverage = average(secondaryValues.filter((v) => Number.isFinite(v) && v >= 0 && v <= 90))
  const maxValue = Math.max(10, ...allValues)
  const completedSets = report.sets.length
    ? report.sets.length
    : Math.floor(report.totalRepetitions / report.targetRepetitionsPerSet)

  return (
    <div className="neck-report-detail">
      <div className="neck-report-summary-grid">
        <div className="neck-report-stat">
          <span>REPETITIONS</span>
          <strong>{report.totalRepetitions}<small> / {report.targetSets * report.targetRepetitionsPerSet}</small></strong>
        </div>
        <div className="neck-report-stat">
          <span>SETS COMPLETED</span>
          <strong>{completedSets}<small> / {report.targetSets}</small></strong>
        </div>
        <div className="neck-report-stat">
          <span>REST INTERVAL</span>
          <strong>{report.restSeconds}<small> sec</small></strong>
        </div>
      </div>

      <section className="neck-report-section">
        <div className="neck-report-section-heading">
          <div>
            <span className="eyebrow">MOVEMENT BREAKDOWN</span>
            <h4>{isSideBend ? 'Left and right tilt' : 'Flexion and extension'}</h4>
          </div>
          <span className="neck-report-unit">2D movement proxy</span>
        </div>
        <p className="chart-description">
          Average recorded movement values. These are experimental webcam estimates, not clinical cervical range-of-motion measurements.
        </p>
        <div className="neck-report-comparison">
          {[{ label: primaryLabel, value: primaryAverage }, { label: secondaryLabel, value: secondaryAverage }].map((item) => (
            <div className="neck-report-comparison-item" key={item.label}>
              <div className="neck-report-comparison-top">
                <span>{item.label}</span>
                <strong>{item.value === null ? '—' : `${item.value.toFixed(1)}°`}</strong>
              </div>
              <div className="neck-report-bar-track">
                <div
                  className="neck-report-bar-fill"
                  style={{ width: `${item.value === null ? 0 : Math.min(100, (item.value / maxValue) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="neck-report-section">
        <div className="neck-report-section-heading">
          <div>
            <span className="eyebrow">REP-BY-REP RESULTS</span>
            <h4>Recorded movement</h4>
          </div>
          <span className="neck-report-unit">{Math.max(primaryValues.length, secondaryValues.length)} records</span>
        </div>
        {Math.max(primaryValues.length, secondaryValues.length) ? (
          <div className="neck-report-table-wrap">
            <table className="neck-report-table">
              <thead>
                <tr>
                  <th>Rep</th>
                  <th>{primaryLabel}</th>
                  <th>{secondaryLabel}</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: Math.max(primaryValues.length, secondaryValues.length) }, (_, index) => {
                  const first = primaryValues[index]
                  const second = secondaryValues[index]
                  const valid = [first, second].every(
                    (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 90
                  )
                  return (
                    <tr key={index}>
                      <td>{String(index + 1).padStart(2, '0')}</td>
                      <td>{typeof first === 'number' && Number.isFinite(first) ? `${first.toFixed(1)}°` : '—'}</td>
                      <td>{typeof second === 'number' && Number.isFinite(second) ? `${second.toFixed(1)}°` : '—'}</td>
                      <td><span className={`neck-report-quality ${valid ? 'valid' : 'review'}`}>{valid ? 'Recorded' : 'Review'}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="neck-report-empty">No individual movement values were recorded for this session.</p>
        )}
      </section>

      <section className="neck-report-section">
        <div className="neck-report-section-heading">
          <div>
            <span className="eyebrow">SET PERFORMANCE</span>
            <h4>Session sets</h4>
          </div>
        </div>
        {report.sets.length ? report.sets.map((set) => (
          <div className="neck-report-set-row" key={set.setNumber}>
            <div>
              <strong>Set {set.setNumber}</strong>
              <span>{set.repetitions} of {set.targetRepetitions} repetitions</span>
            </div>
            <div className="neck-report-set-track">
              <div style={{ width: `${Math.min(100, (set.repetitions / set.targetRepetitions) * 100)}%` }} />
            </div>
          </div>
        )) : (
          <p className="neck-report-empty">
            Per-set breakdown was not saved for this session. Rep-level movement data is shown above.
          </p>
        )}
      </section>

      <details className="report-raw-details">
        <summary>View AI-ready session data</summary>
        <pre className="report-json">
          {JSON.stringify({
            patientName: report.patientName,
            exercise: report.exercise,
            totalRepetitions: report.totalRepetitions,
            sets: report.sets,
            movementMetrics: report.movementMetrics,
            aiAnalysisInput: report.aiAnalysisInput,
          }, null, 2)}
        </pre>
      </details>
      <p className="neck-report-disclaimer">{report.dataQualityNote}</p>
    </div>
  )
}

function OtDashboard({
  account,
  logout,
  reports,
  theme,
  toggleTheme,
  onReportsRefresh,
}: {
  account: Account
  logout: () => void
  reports: SessionReport[]
  theme: 'light' | 'dark'
  toggleTheme: () => void
  onReportsRefresh: () => void
}) {
  const patients = accounts.filter(
    (item): item is Account & { role: 'knee' | 'neck' } =>
      item.role === 'knee' || item.role === 'neck'
  )
  const [selectedPatient, setSelectedPatient] = useState<Account | null>(null)
  const [selectedReport, setSelectedReport] = useState<SessionReport | null>(null)
  const [restSeconds, setRestSeconds] = useState(DEFAULT_REST_SECONDS)
  const [restSaved, setRestSaved] = useState(false)

  function openPatient(patient: Account) {
    setSelectedPatient(patient)
    setSelectedReport(null)
    setRestSeconds(readPatientRestSeconds(patient.username))
    setRestSaved(false)
  }

  function savePatientRest() {
    if (!selectedPatient) return
    const safeValue = Math.max(5, Math.min(300, Number(restSeconds) || DEFAULT_REST_SECONDS))
    localStorage.setItem(patientRestKey(selectedPatient.username), String(safeValue))
    // Keep the session components' existing storage contract in sync for this patient.
    localStorage.setItem(REST_SETTING_KEY, String(safeValue))
    setRestSeconds(safeValue)
    setRestSaved(true)
  }

  const sortedReports = [...reports].sort(
    (a, b) => b.completedAt.localeCompare(a.completedAt)
  )
  const patientReports = selectedPatient
    ? sortedReports.filter((report) => report.patientName === selectedPatient.name)
    : []

  return (
    <div className="dashboard ot-dashboard">
      <Header
        name={account.name}
        role="Occupational Therapist"
        logout={logout}
        theme={theme}
        toggleTheme={toggleTheme}
      />

      <main className="dashboard-content ot-content">
        <span className="eyebrow">CLINICAL WORKSPACE</span>
        <h2>Good evening, Dr. Who.</h2>
        <p className="dashboard-subtitle">
          Manage patient programs, review session reports, and personalize recovery settings.
        </p>

        {!selectedPatient ? (
          <>
            <div className="ot-section-header">
              <div>
                <span className="eyebrow">PATIENT MANAGEMENT</span>
                <h3>My patients</h3>
                <p className="ot-section-subtitle">Select a patient to view their reports and individual program settings.</p>
              </div>
              <button className="secondary-action" onClick={onReportsRefresh}>
                Refresh reports
              </button>
            </div>

            <div className="ot-patient-grid">
              {patients.map((patient) => {
                const count = sortedReports.filter(
                  (report) => report.patientName === patient.name
                ).length
                return (
                  <button
                    className="ot-patient-card"
                    key={patient.username}
                    onClick={() => openPatient(patient)}
                  >
                    <div className="ot-patient-avatar">
                      {patient.name.split(' ').map((part) => part[0]).join('')}
                    </div>
                    <div className="ot-patient-main">
                      <strong>{patient.name}</strong>
                      <span>{patient.role === 'knee' ? 'Knee rehabilitation' : 'Neck rehabilitation'}</span>
                      <small>{count} session {count === 1 ? 'report' : 'reports'} available</small>
                    </div>
                    <div className="ot-patient-action">
                      <span className="status-label">Active</span>
                      <span className="ot-patient-arrow">View patient →</span>
                    </div>
                  </button>
                )
              })}
            </div>

            <section className="ot-overview-card">
              <span className="eyebrow">RECENT ACTIVITY</span>
              <h3>Latest session reports</h3>
              {sortedReports.length ? (
                <div className="ot-recent-list">
                  {sortedReports.slice(0, 4).map((report) => (
                    <button
                      className="ot-recent-row"
                      key={report.id}
                      onClick={() => {
                        const patient = patients.find((item) => item.name === report.patientName)
                        if (patient) {
                          setSelectedPatient(patient)
                          setRestSeconds(readPatientRestSeconds(patient.username))
                          setSelectedReport(report)
                        }
                      }}
                    >
                      <span>
                        <strong>{report.patientName}</strong>
                        <small>{report.exercise} · {new Date(report.completedAt).toLocaleString()}</small>
                      </span>
                      <span>{report.totalRepetitions} reps →</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="empty-reports">Completed patient sessions will appear here.</p>
              )}
            </section>
          </>
        ) : (
          <>
            <button
              className="back-link ot-back-link"
              onClick={() => {
                setSelectedPatient(null)
                setSelectedReport(null)
                setRestSaved(false)
              }}
            >
              ← All patients
            </button>

            <section className="ot-patient-profile">
              <div className="ot-patient-avatar large">
                {selectedPatient.name.split(' ').map((part) => part[0]).join('')}
              </div>
              <div>
                <span className="eyebrow">PATIENT PROFILE</span>
                <h3>{selectedPatient.name}</h3>
                <p>{selectedPatient.role === 'knee' ? 'Knee rehabilitation program' : 'Neck rehabilitation program'}</p>
              </div>
              <span className="status-label">Active</span>
            </section>

            <section className="ot-settings-card ot-personal-settings">
              <span className="eyebrow">INDIVIDUAL THERAPIST CONTROLS</span>
              <h3>Rest interval for {selectedPatient.name.split(' ')[0]}</h3>
              <p>
                This setting is saved specifically for this patient and is applied to their next exercise session.
              </p>
              <label htmlFor="ot-patient-rest-seconds">Rest duration (seconds)</label>
              <div className="rest-setting-row">
                <input
                  id="ot-patient-rest-seconds"
                  type="number"
                  min="5"
                  max="300"
                  value={restSeconds}
                  onChange={(event) => {
                    setRestSeconds(Number(event.target.value))
                    setRestSaved(false)
                  }}
                />
                <button className="secondary-action" onClick={savePatientRest}>
                  Save patient setting
                </button>
              </div>
              <small>
                Current saved setting: {readPatientRestSeconds(selectedPatient.username)} seconds. Choose between 5 and 300 seconds.
              </small>
              {restSaved && (
                <p className="ot-saved-message">✓ Rest interval saved for {selectedPatient.name}.</p>
              )}
            </section>

            <div className="ot-section-header ot-patient-reports-heading">
              <div>
                <span className="eyebrow">PATIENT HISTORY</span>
                <h3>Session reports</h3>
                <p className="ot-section-subtitle">Only reports belonging to {selectedPatient.name} are shown here.</p>
              </div>
              <button className="secondary-action" onClick={onReportsRefresh}>
                Refresh reports
              </button>
            </div>

            {selectedReport ? (
              <section className="report-detail">
                <button className="back-link" onClick={() => setSelectedReport(null)}>
                  ← {selectedPatient.name}'s reports
                </button>
                <h3>{selectedReport.exercise}</h3>
                <p>{selectedReport.patientName} · {new Date(selectedReport.completedAt).toLocaleString()}</p>

                {'movementMetrics' in selectedReport ? (
                  <NeckReportDetail report={selectedReport} />
                ) : (
                  <>
                    <section className="ot-patient-feedback" aria-labelledby="patient-feedback-heading">
                      <h4 id="patient-feedback-heading">Patient feedback — priority for OT review</h4>
                      <div className="ot-feedback-grid">
                        <div>
                          <strong>Before exercise</strong>
                          <span>{selectedReport.patientFeedback?.before?.label ?? 'Not provided'}{selectedReport.patientFeedback?.before?.rating ? ` (${selectedReport.patientFeedback.before.rating}/5)` : ''}</span>
                          {selectedReport.patientFeedback?.before?.comment && <p>{selectedReport.patientFeedback.before.comment}</p>}
                        </div>
                        <div>
                          <strong>During exercise</strong>
                          <span>{selectedReport.patientFeedback?.during?.label ?? 'Not provided'}{selectedReport.patientFeedback?.during?.rating ? ` (${selectedReport.patientFeedback.during.rating}/5)` : ''}</span>
                          {selectedReport.patientFeedback?.during?.comment && <p>{selectedReport.patientFeedback.during.comment}</p>}
                        </div>
                      </div>
                    </section>
                    <div className="report-metrics">
                      <div>
                        <span>REPS COMPLETED</span>
                        <strong>{selectedReport.totalRepetitions}/{selectedReport.targetSets * selectedReport.targetRepetitionsPerSet}</strong>
                      </div>
                      <div>
                        <span>BEST EXTENSION</span>
                        <strong>{selectedReport.bestExtensionAngle ?? '--'}°</strong>
                      </div>
                      <div>
                        <span>AVERAGE EXTENSION</span>
                        <strong>{selectedReport.averageExtensionAngle ?? '--'}°</strong>
                      </div>
                    </div>
                    <h4>Angle progression</h4>
                    <p className="chart-description">Recorded peak movement angle for each completed repetition.</p>
                    <AngleProgressChart sets={selectedReport.sets} />
                    <h4>Set-by-set performance</h4>
                    {selectedReport.sets.map((set) => (
                      <div className="report-set" key={set.setNumber}>
                        <strong>Set {set.setNumber}: {set.repetitions}/{set.targetRepetitions} reps</strong>
                        <p>Best: {set.bestAngle ?? '--'} · Average: {set.averageAngle ?? '--'}</p>
                        <p>Recorded values: {set.angles.join(', ') || 'No completed reps'}</p>
                      </div>
                    ))}
                    <details className="report-raw-details">
                      <summary>View AI-ready session data</summary>
                      <pre className="report-json">{JSON.stringify({
                        patientName: selectedReport.patientName,
                        exercise: selectedReport.exercise,
                        sets: selectedReport.sets,
                        patientFeedback: selectedReport.patientFeedback,
                        bestExtensionAngle: selectedReport.bestExtensionAngle,
                        averageExtensionAngle: selectedReport.averageExtensionAngle,
                        aiAnalysisInput: selectedReport.aiAnalysisInput,
                      }, null, 2)}</pre>
                    </details>
                  </>
                )}
                <ReportReviewPanel
                  key={selectedReport.id}
                  report={selectedReport}
                  onUpdated={(updated) => {
                    setSelectedReport(updated as SessionReport)
                    onReportsRefresh()
                  }}
                />
                <p className="demo-note">
                  {selectedReport.dataQualityNote} This is a descriptive data report, not an AI-generated clinical assessment.
                </p>
              </section>
            ) : patientReports.length ? (
              <div className="report-list">
                {patientReports.map((report) => (
                  <button
                    className="report-card"
                    key={report.id}
                    onClick={() => setSelectedReport(report)}
                  >
                    <div>
                      <strong>{report.exercise}</strong>
                      <p>{new Date(report.completedAt).toLocaleString()} · {report.status}</p>
                    </div>
                    <span>
                      {report.totalRepetitions} reps
                      {'bestExtensionAngle' in report
                        ? ` · Best ${report.bestExtensionAngle ?? '--'}°`
                        : ' · Neck movement data'} →
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-reports">
                No session reports for {selectedPatient.name} yet. Completed sessions will appear here.
              </div>
            )}
          </>
        )}

        <p className="demo-note">
          Fictional demonstration data · Local browser storage only · Not for clinical decision-making.
        </p>
      </main>
    </div>
  )
}

export default App
