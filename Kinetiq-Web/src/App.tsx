
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import KneeSession, { type KneeSessionReport } from './KneeSession'
import './App.css'

type Role = 'knee' | 'neck' | 'ot'
type Account = { username: string; password: string; role: Role; name: string }

const accounts: Account[] = [
  { username: 'knee.patient', password: '1234', role: 'knee', name: 'Alex Morgan' },
  { username: 'tbi.patient', password: '1234', role: 'neck', name: 'Jordan Taylor' },
  { username: 'ot.admin', password: '1234', role: 'ot', name: 'Dr. Sarah Bennett' },
]

const REPORTS_KEY = 'kinetiq.sessionReports'
const REST_SETTING_KEY = 'kinetiq.ot.restSeconds'

function readReports(): KneeSessionReport[] {
  try {
    return JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]') as KneeSessionReport[]
  } catch {
    return []
  }
}


const WEEKLY_CHECKLIST_KEY = 'kinetiq.weeklyChecklist'
const DEMO_COMPLETED_WEEK = '2026-11-08'

const WEEKLY_EXERCISES = [
  { day: 'Sunday', exercise: 'Seated Knee Extensions', type: 'tracked' },
  { day: 'Monday', exercise: 'Standing Knee Raises', type: 'manual' },
  { day: 'Tuesday', exercise: 'Seated Knee Extensions', type: 'tracked' },
  { day: 'Wednesday', exercise: 'Standing Knee Raises', type: 'manual' },
  { day: 'Thursday', exercise: 'Seated Knee Extensions', type: 'tracked' },
  { day: 'Friday', exercise: 'Standing Knee Raises', type: 'manual' },
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

function readWeeklyChecklist(weekKey: string): number[] {
  try {
    const saved = JSON.parse(
      localStorage.getItem(WEEKLY_CHECKLIST_KEY) || '{}'
    )
    return saved[weekKey] || []
  } catch {
    return []
  }
}

function saveCompletedDay(weekKey: string, dayIndex: number) {
  try {
    const saved = JSON.parse(
      localStorage.getItem(WEEKLY_CHECKLIST_KEY) || '{}'
    )
    const completed: number[] = saved[weekKey] || []

    if (!completed.includes(dayIndex)) completed.push(dayIndex)

    saved[weekKey] = completed
    localStorage.setItem(WEEKLY_CHECKLIST_KEY, JSON.stringify(saved))
  } catch {
    console.error('Could not save weekly checklist.')
  }
}

function App() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [account, setAccount] = useState<Account | null>(null)
  const [error, setError] = useState('')
  const [reports, setReports] = useState<KneeSessionReport[]>(readReports)

  function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const matched = accounts.find(
      (item) => item.username === username && item.password === password
    )

    if (!matched) {
      setError('Incorrect username or password. Please try again.')
      return
    }

    setError('')
    setAccount(matched)
    if (matched.role === 'ot') setReports(readReports())
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
              {error && <p className="error-message">{error}</p>}
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
        onReport={(report) => setReports((old) => [...old, report])}
      />
    )
  }

  if (account.role === 'neck') {
    return <NeckDashboard account={account} logout={logout} />
  }

  return (
    <OtDashboard
      account={account}
      logout={logout}
      reports={reports}
      onReportsRefresh={() => setReports(readReports())}
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
        <button className="logout-button" onClick={logout}>Sign out</button>
      </div>
    </header>
  )
}

function PatientDashboard({
  account,
  logout,
  onReport,
}: {
  account: Account
  logout: () => void
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
    return (
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
        <Header name={account.name} role="Patient" logout={logout} />
        <main className="dashboard-content">
          <button className="back-link" onClick={() => setSelectedDay(null)}>
            ← Back to weekly plan
          </button>

          <span className="eyebrow">
            {selectedExercise.day.toUpperCase()} · KNEE REHABILITATION
          </span>
          <h2>{selectedExercise.exercise}</h2>
          <p className="dashboard-subtitle">
            Your scheduled rehabilitation activity.
          </p>

          <section className="program-card">
            <div>
              <span className="eyebrow">SCHEDULED EXERCISE</span>
              <h3>2 sets × 10 repetitions</h3>
              <p>Follow your occupational therapist's instructions.</p>
            </div>
          </section>

          {selectedExercise.type === 'tracked' ? (
            <>
              <p className="demo-note">
                This exercise uses Kinetiq's camera-based movement tracking.
              </p>
              <button
                className="primary-action"
                onClick={() => setShowSession(true)}
              >
                {completedDays.includes(selectedDay)
                  ? 'Replay seated knee extension →'
                  : 'Start seated knee extension →'}
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
          <div className="weekly-progress-track">
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
                  <small>
                    2 sets × 10 reps ·{' '}
                    {item.type === 'tracked'
                      ? 'Camera tracked'
                      : 'Manual checkoff'}
                  </small>
                  <span className="weekly-day-status">
                    {isCompleted
                      ? 'Completed · Demo replay available'
                      : isFuture
                        ? `${availabilityLabel} · Demo access`
                        : availabilityLabel}
                  </span>
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
            <strong>Gentle Neck Rotation</strong>
            <p>Therapist-assigned repetitions</p>
          </div>
          <div className="exercise-row">
            <strong>Neck Side Bends</strong>
            <p>Therapist-assigned repetitions</p>
          </div>
          <div className="exercise-row">
            <strong>Neck Flexion and Extension</strong>
            <p>Therapist-assigned repetitions</p>
          </div>
        </div>
        <button className="primary-action" disabled>
          Neck session coming soon
        </button>
        <p className="demo-note">
          Demonstration program · Perform only exercises assigned by your therapist.
        </p>
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
          aria-label="Line chart of recorded peak knee angles across repetitions"
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
        Repetition number · Recorded peak angle in degrees
      </p>
    </div>
  )
}

function OtDashboard({
  account,
  logout,
  reports,
  onReportsRefresh,
}: {
  account: Account
  logout: () => void
  reports: KneeSessionReport[]
  onReportsRefresh: () => void
}) {
  const [restSeconds, setRestSeconds] = useState(
    () => Number(localStorage.getItem(REST_SETTING_KEY) || 45)
  )
  const [selectedReport, setSelectedReport] =
    useState<KneeSessionReport | null>(null)

  function saveRest() {
    const safeValue = Math.max(5, Math.min(300, restSeconds))
    localStorage.setItem(REST_SETTING_KEY, String(safeValue))
    setRestSeconds(safeValue)
  }

  const sortedReports = [...reports].sort(
    (a, b) => b.completedAt.localeCompare(a.completedAt)
  )

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
            <span>SESSION REPORTS</span>
            <strong>{sortedReports.length.toString().padStart(2, '0')}</strong>
          </div>
        </div>

        <div className="ot-section-header">
          <div>
            <span className="eyebrow">PATIENT MANAGEMENT</span>
            <h3>My patients</h3>
          </div>
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

        <section className="ot-settings-card">
          <span className="eyebrow">THERAPIST CONTROLS</span>
          <h3>Rest interval settings</h3>
          <p>
            Set the recovery interval applied automatically after each
            completed set and after the seated knee extension exercise.
          </p>
          <label htmlFor="ot-rest-seconds">Rest duration (seconds)</label>
          <div className="rest-setting-row">
            <input
              id="ot-rest-seconds"
              type="number"
              min="5"
              max="300"
              value={restSeconds}
              onChange={(e) => setRestSeconds(Number(e.target.value))}
            />
            <button className="secondary-action" onClick={saveRest}>
              Save rest setting
            </button>
          </div>
          <small>
            Saved setting: {Number(localStorage.getItem(REST_SETTING_KEY) || 45)}
            {' '}seconds. Patients receive this value when they start a session.
          </small>
        </section>

        <div className="ot-section-header">
          <div>
            <span className="eyebrow">CLINICAL WORKSPACE</span>
            <h3>Session reports</h3>
          </div>
          <button className="secondary-action" onClick={onReportsRefresh}>
            Refresh reports
          </button>
        </div>

        {selectedReport ? (
          <section className="report-detail">
            <button
              className="back-link"
              onClick={() => setSelectedReport(null)}
            >
              ← All reports
            </button>

            <h3>{selectedReport.exercise}</h3>
            <p>
              {selectedReport.patientName} ·{' '}
              {new Date(selectedReport.completedAt).toLocaleString()}
            </p>

            <div className="report-metrics">
              <div>
                <span>REPS COMPLETED</span>
                <strong>
                  {selectedReport.totalRepetitions}/
                  {selectedReport.targetSets *
                    selectedReport.targetRepetitionsPerSet}
                </strong>
              </div>
              <div>
                <span>BEST EXTENSION</span>
                <strong>
                  {selectedReport.bestExtensionAngle ?? '--'}°
                </strong>
              </div>
              <div>
                <span>AVERAGE EXTENSION</span>
                <strong>
                  {selectedReport.averageExtensionAngle ?? '--'}°
                </strong>
              </div>
            </div>

            <h4>Angle progression</h4>
            <p className="chart-description">
              Recorded peak angle for each completed repetition.
            </p>
            <AngleProgressChart sets={selectedReport.sets} />

            <h4>Set-by-set performance</h4>
            {selectedReport.sets.map((set) => (
              <div className="report-set" key={set.setNumber}>
                <strong>
                  Set {set.setNumber}: {set.repetitions}/
                  {set.targetRepetitions} reps
                </strong>
                <p>
                  Best: {set.bestAngle ?? '--'}° · Average:{' '}
                  {set.averageAngle ?? '--'}°
                </p>
                <p>
                  Per-repetition peak angles:{' '}
                  {set.angles.map((angle) => `${angle}°`).join(', ') ||
                    'No completed reps'}
                </p>
              </div>
            ))}

            <h4>AI-ready session data</h4>
            <pre className="report-json">
              {JSON.stringify(
                {
                  patientName: selectedReport.patientName,
                  exercise: selectedReport.exercise,
                  sets: selectedReport.sets,
                  sessionBest: selectedReport.bestExtensionAngle,
                  sessionAverage: selectedReport.averageExtensionAngle,
                  aiAnalysisInput: selectedReport.aiAnalysisInput,
                },
                null,
                2
              )}
            </pre>

            <p className="demo-note">
              {selectedReport.dataQualityNote} This is a descriptive data
              report, not an AI-generated clinical assessment.
            </p>
          </section>
        ) : sortedReports.length ? (
          <div className="report-list">
            {sortedReports.map((report) => (
              <button
                className="report-card"
                key={report.id}
                onClick={() => setSelectedReport(report)}
              >
                <div>
                  <strong>{report.patientName} · {report.exercise}</strong>
                  <p>
                    {new Date(report.completedAt).toLocaleString()} · {report.status}
                  </p>
                </div>
                <span>
                  {report.totalRepetitions} reps · Best{' '}
                  {report.bestExtensionAngle ?? '--'}° →
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-reports">
            No session reports yet. Completed patient sessions will appear here.
          </div>
        )}

        <p className="demo-note">
          Fictional demonstration data · Local browser storage only ·
          Not for clinical decision-making.
        </p>
      </main>
    </div>
  )
}

export default App
