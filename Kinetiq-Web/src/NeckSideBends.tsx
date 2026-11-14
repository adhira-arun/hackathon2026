import { useEffect, useRef, useState } from 'react'
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import './App.css'

type SessionStatus = 'ready' | 'exercising' | 'resting' | 'completed' | 'paused'

type PosePoint = {
  x: number
  y: number
  visibility?: number
  presence?: number
}

type NeckSetReport = {
  setNumber: number
  repetitions: number
  angles: number[]
  bestAngle: number | null
  averageAngle: number | null
  targetRepetitions: number
}

export type NeckSessionReport = {
  id: string
  patientName: string
  exercise: string
  completedAt: string
  status: 'completed' | 'incomplete'
  targetRepetitionsPerSet: number
  targetSets: number
  restSeconds: number
  totalRepetitions: number
  sets: NeckSetReport[]
  repAngles: number[]
  movementMetrics: Record<string, number | number[]>
  dataQualityNote: string
  patientFeedback: {
    before: { rating: number | null; label: string; comment: string }
    during: { rating: number | null; label: string; comment: string }
  }
  aiAnalysisInput: {
    purpose: string
    priorityPatientFeedback: {
      beforeExercise: { rating: number | null; label: string; comment: string }
      duringExercise: { rating: number | null; label: string; comment: string }
      interpretation: string
    }
    metrics: string[]
    instruction: string
  }
}

type Props = {
  onBack: () => void
  onComplete: (report: NeckSessionReport) => void
}

const TARGET_REPS = 10
const TARGET_SETS = 2
const REQUIRED_FRAMES = 3
const MIN_VISIBILITY = 0.45
const MIN_REP_INTERVAL_MS = 900
const REST_SETTING_KEY = 'kinetiq.ot.restSeconds'
const REPORTS_KEY = 'kinetiq.sessionReports'

const CONNECTIONS = [
  [7, 8], [7, 11], [8, 12], [11, 12], [11, 13], [13, 15],
  [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
]

function confidence(point: PosePoint | undefined) {
  if (!point) return 0
  const values = [point.visibility, point.presence].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  )
  return values.length ? Math.max(...values) : 0
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function restSeconds() {
  const value = Number(localStorage.getItem(REST_SETTING_KEY) || 45)
  return Number.isFinite(value) ? Math.max(5, Math.min(300, value)) : 45
}

function midpoint(a: PosePoint, b: PosePoint) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function signedHeadTilt(landmarks: PosePoint[]) {
  const leftEar = landmarks[7]
  const rightEar = landmarks[8]
  if (!leftEar || !rightEar) return null

  // Use the absolute horizontal ear separation so the sign is not flipped
  // by the mirrored/front-facing webcam coordinate order. MediaPipe's
  // right-ear landmark moving downward produces a positive (right) tilt;
  // the left ear moving downward produces a negative (left) tilt.
  const horizontalSeparation = Math.abs(rightEar.x - leftEar.x)
  if (horizontalSeparation < 0.02) return null

  return Math.atan2(rightEar.y - leftEar.y, horizontalSeparation) * 180 / Math.PI
}

function headPitchProxy(landmarks: PosePoint[]) {
  const nose = landmarks[0]
  const leftEar = landmarks[7]
  const rightEar = landmarks[8]
  const leftShoulder = landmarks[11]
  const rightShoulder = landmarks[12]
  if (!nose || !leftEar || !rightEar || !leftShoulder || !rightShoulder) return null

  const earMid = midpoint(leftEar, rightEar)
  const shoulderMid = midpoint(leftShoulder, rightShoulder)
  const shoulderWidth = Math.hypot(
    rightShoulder.x - leftShoulder.x,
    rightShoulder.y - leftShoulder.y
  )
  if (shoulderWidth < 0.05) return null

  // Normalized nose displacement relative to the ear/shoulder frame.
  // This is a 2D movement proxy, not a clinical cervical angle.
  return ((nose.y - earMid.y) / shoulderWidth) * 100
}

function painLabel(score: number) {
  if (score === 0) return 'No pain'
  if (score <= 2) return 'Mild'
  if (score <= 4) return 'Moderate'
  if (score <= 7) return 'Severe'
  if (score <= 9) return 'Very severe'
  return 'Worst pain'
}

function speak(message: string) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(message)
  utterance.rate = 0.95
  window.speechSynthesis.speak(utterance)
}


function NeckSideBends({ onBack, onComplete }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const landmarkerRef = useRef<PoseLandmarker | null>(null)
  const statusRef = useRef<SessionStatus>('ready')
  const neutralRef = useRef<number | null>(null)
  const phaseRef = useRef<'left' | 'center-after-left' | 'right' | 'center-after-right'>('left')
  const leftPeakRef = useRef(0)
  const rightPeakRef = useRef(0)
  const frameCountRef = useRef(0)
  const historyRef = useRef<number[]>([])
  const lastRepTimeRef = useRef(0)
  const repDataRef = useRef<{ left: number; right: number }[]>([])
  const completionSentRef = useRef(false)

  const [cameraOn, setCameraOn] = useState(false)
  const [beforeFeeling, setBeforeFeeling] = useState<number | null>(null)
  const [beforeComment, setBeforeComment] = useState('')
  const [duringFeeling, setDuringFeeling] = useState<number | null>(null)
  const [duringComment, setDuringComment] = useState('')
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false)
  const [trackingStatus, setTrackingStatus] = useState('Waiting for camera')
  const [error, setError] = useState('')
  const [status, setStatus] = useState<SessionStatus>('ready')
  const [repetitions, setRepetitions] = useState(0)
  const [setNumber, setSetNumber] = useState(1)
  const [liveAngle, setLiveAngle] = useState<number | null>(null)
  const [movementMessage, setMovementMessage] = useState('Face the camera with your shoulders visible.')
  const [restRemaining, setRestRemaining] = useState(restSeconds())
  const [setReports, setSetReports] = useState<NeckSetReport[]>([])
  const [restDuration] = useState(restSeconds)
  const [restPhase, setRestPhase] = useState<'set' | 'exercise'>('set')

  function updateStatus(next: SessionStatus) {
    statusRef.current = next
    setStatus(next)
  }

  async function startCamera() {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      setCameraOn(true)
    } catch {
      setTrackingStatus('Camera unavailable')
      setError('Camera access unavailable. Allow camera permission and try again.')
    }
  }

  useEffect(() => {
    if (cameraOn && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.play().catch(() => setError('Unable to start camera preview.'))
    }
  }, [cameraOn])

  useEffect(() => {
    if (!cameraOn) return
    let cancelled = false
    let animationFrame = 0
    let landmarker: PoseLandmarker | null = null

    async function initialize() {
      try {
        setTrackingStatus('Loading pose detection')
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        )
        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        })
        if (cancelled) { landmarker.close(); return }
        landmarkerRef.current = landmarker
        const video = videoRef.current
        const canvas = canvasRef.current
        if (!video || !canvas) throw new Error('Camera preview not found.')

        function detect() {
          if (cancelled || !video || !canvas || !landmarker || video.readyState < 2) {
            if (!cancelled) animationFrame = requestAnimationFrame(detect)
            return
          }
          const width = video.videoWidth
          const height = video.videoHeight
          if (!width || !height) { animationFrame = requestAnimationFrame(detect); return }
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width
            canvas.height = height
          }
          const context = canvas.getContext('2d')
          if (!context) return
          context.clearRect(0, 0, width, height)
          try {
            const result = landmarker.detectForVideo(video, performance.now())
            if (result.landmarks.length) {
              const points = result.landmarks[0] as PosePoint[]
              context.strokeStyle = '#D8C4A8'
              context.lineWidth = Math.max(3, width / 250)
              CONNECTIONS.forEach(([a, b]) => {
                if (confidence(points[a]) < 0.3 || confidence(points[b]) < 0.3) return
                context.beginPath()
                context.moveTo(points[a].x * width, points[a].y * height)
                context.lineTo(points[b].x * width, points[b].y * height)
                context.stroke()
              })
              // Draw visible landmark markers on the head and shoulder joints.
              ;[0, 7, 8, 11, 12].forEach((index) => {
                const point = points[index]
                if (confidence(point) < 0.3) return
                context.beginPath()
                context.fillStyle = '#B89B78'
                context.arc(point.x * width, point.y * height, Math.max(5, width / 180), 0, Math.PI * 2)
                context.fill()
                context.lineWidth = Math.max(2, width / 500)
                context.strokeStyle = '#F7F2E9'
                context.stroke()
              })
              const required = [7, 8, 11, 12]
              const visible = required.every((index) => confidence(points[index]) >= MIN_VISIBILITY)
              if (visible) {
                setTrackingStatus('Head and shoulders detected')
                const raw = signedHeadTilt(points)
                if (raw !== null && Number.isFinite(raw)) {
                  historyRef.current = [...historyRef.current.slice(-4), raw]
                  const angle = median(historyRef.current)
                  setLiveAngle(angle)
                  if (statusRef.current === 'exercising') {
                    if (neutralRef.current === null) {
                      neutralRef.current = angle
                      setMovementMessage('Neutral position calibrated. Begin with a gentle left tilt.')
                    } else {
                      const delta = angle - neutralRef.current
                      // Side bends are measured as deviation from the user's calibrated neutral.
                      const leftMagnitude = Math.max(0, -delta)
                      const rightMagnitude = Math.max(0, delta)
                      const now = performance.now()
                      if (phaseRef.current === 'left') {
                        if (leftMagnitude >= 8) frameCountRef.current++
                        else frameCountRef.current = 0
                        if (frameCountRef.current >= REQUIRED_FRAMES) {
                          leftPeakRef.current = leftMagnitude
                          phaseRef.current = 'center-after-left'
                          frameCountRef.current = 0
                          setMovementMessage('Left tilt detected. Return to neutral.')
                        }
                      } else if (phaseRef.current === 'center-after-left') {
                        leftPeakRef.current = Math.max(leftPeakRef.current, leftMagnitude)
                        if (Math.abs(delta) <= 3) frameCountRef.current++
                        else frameCountRef.current = 0
                        if (frameCountRef.current >= REQUIRED_FRAMES) {
                          phaseRef.current = 'right'
                          frameCountRef.current = 0
                          setMovementMessage('Neutral detected. Gently tilt to the right.')
                        }
                      } else if (phaseRef.current === 'right') {
                        if (rightMagnitude >= 8) frameCountRef.current++
                        else frameCountRef.current = 0
                        if (frameCountRef.current >= REQUIRED_FRAMES) {
                          rightPeakRef.current = rightMagnitude
                          phaseRef.current = 'center-after-right'
                          frameCountRef.current = 0
                          setMovementMessage('Right tilt detected. Return to neutral to complete the repetition.')
                        }
                      } else {
                        rightPeakRef.current = Math.max(rightPeakRef.current, rightMagnitude)
                        if (Math.abs(delta) <= 3) frameCountRef.current++
                        else frameCountRef.current = 0
                        if (frameCountRef.current >= REQUIRED_FRAMES && now - lastRepTimeRef.current > MIN_REP_INTERVAL_MS) {
                          const record = { left: Math.round(leftPeakRef.current * 10) / 10, right: Math.round(rightPeakRef.current * 10) / 10 }
                          repDataRef.current = [...repDataRef.current, record]
                          const next = repDataRef.current.length
                          setRepetitions(next)
                          lastRepTimeRef.current = now
                          phaseRef.current = 'left'
                          leftPeakRef.current = 0
                          rightPeakRef.current = 0
                          frameCountRef.current = 0
                          setMovementMessage(`Repetition ${next} recorded. Begin the next gentle left tilt.`)
                          if (next >= TARGET_REPS) finishSet()
                        }
                      }
                    }
                  }
                }
              } else {
                setTrackingStatus('Move head and both shoulders into view')
                setLiveAngle(null)
                frameCountRef.current = 0
              }
            } else {
              setTrackingStatus('No body detected')
              setLiveAngle(null)
            }
          } catch {
            setTrackingStatus('Tracking paused')
          }
          animationFrame = requestAnimationFrame(detect)
        }
        detect()
      } catch (err) {
        console.error('Neck side-bend tracking error:', err)
        if (!cancelled) {
          setTrackingStatus('Tracking unavailable')
          setError('Unable to load pose detection. Check your connection and try again.')
        }
      }
    }
    initialize()
    return () => {
      cancelled = true
      cancelAnimationFrame(animationFrame)
      landmarker?.close()
      landmarkerRef.current = null
    }
  }, [cameraOn])

  function finishSet() {
    const values = repDataRef.current
    const angles = values.map((item) => (item.left + item.right) / 2)
    const current = {
      setNumber,
      repetitions: values.length,
      angles,
      bestAngle: angles.length ? Math.max(...angles) : null,
      averageAngle: angles.length ? Math.round(angles.reduce((a, b) => a + b, 0) / angles.length) : null,
      targetRepetitions: TARGET_REPS,
    }
    setSetReports((previous) => [...previous.filter((item) => item.setNumber !== setNumber), current])
    setRestPhase(setNumber < TARGET_SETS ? 'set' : 'exercise')
    updateStatus('resting')
    setRestRemaining(restDuration)
    setMovementMessage('Set complete. Rest period started.')
    speak('Set complete. Time to rest.')
  }

  function saveReport(reportStatus: 'completed' | 'incomplete' = 'completed') {
    if (completionSentRef.current) return
    completionSentRef.current = true
    const records = repDataRef.current
    const angles = records.map((item) => (item.left + item.right) / 2)
    const sets = [...setReports]
    const report: NeckSessionReport = {
      id: `neck-side-bends-${Date.now()}`,
      patientName: 'Jordan Taylor',
      exercise: 'Neck side bends',
      completedAt: new Date().toISOString(),
      status: reportStatus,
      targetRepetitionsPerSet: TARGET_REPS,
      targetSets: TARGET_SETS,
      restSeconds: restDuration,
      totalRepetitions: records.length,
      sets,
      repAngles: angles,
      movementMetrics: {
        leftTiltDegrees: records.map((item) => item.left),
        rightTiltDegrees: records.map((item) => item.right),
      },
      dataQualityNote: '2D webcam pose estimates are experimental and are not clinically validated. Camera angle, head rotation, landmark visibility, and posture can affect readings.',
      patientFeedback: {
        before: { rating: beforeFeeling, label: beforeFeeling === null ? 'Not provided' : painLabel(beforeFeeling), comment: beforeComment },
        during: { rating: duringFeeling, label: duringFeeling === null ? 'Not provided' : painLabel(duringFeeling), comment: duringComment },
      },
      aiAnalysisInput: {
        purpose: 'Provide an OT-facing descriptive summary of observed neck side-bend movement, not a diagnosis or treatment recommendation.',
        priorityPatientFeedback: {
          beforeExercise: { rating: beforeFeeling, label: beforeFeeling === null ? 'Not provided' : painLabel(beforeFeeling), comment: beforeComment },
          duringExercise: { rating: duringFeeling, label: duringFeeling === null ? 'Not provided' : painLabel(duringFeeling), comment: duringComment },
          interpretation: "Treat patient-reported feelings and comments as high-priority context for OT review. Report them clearly, compare before and during ratings, and do not infer a diagnosis from the patient's self-reported pain or discomfort rating.",
        },
        metrics: ['completed repetitions', 'left tilt movement proxy per rep', 'right tilt movement proxy per rep', 'left/right consistency', 'set-by-set performance', 'data quality limitations'],
        instruction: 'Lead the summary with patient-reported before and during exercise feedback. Then describe observed movement trends and measurement limitations. Do not infer pain, strength, diagnosis, or clinical range of motion.',
      },
    }
    try {
      const previous = JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]')
      localStorage.setItem(REPORTS_KEY, JSON.stringify([...previous, report]))
    } catch (err) {
      console.error('Unable to save neck side-bend report:', err)
    }
    onComplete(report)
  }

  useEffect(() => {
    if (status !== 'resting') return
    const endTime = Date.now() + restDuration * 1000
    const interval = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000))
      setRestRemaining(remaining)
      if (remaining <= 0) {
        window.clearInterval(interval)
        if (restPhase === 'set' && setNumber < TARGET_SETS) {
          setSetNumber((value) => value + 1)
          setRepetitions(0)
          repDataRef.current = []
          neutralRef.current = null
          phaseRef.current = 'left'
          frameCountRef.current = 0
          historyRef.current = []
          updateStatus('exercising')
          setMovementMessage('Rest complete. Recalibrate neutral, then begin the next set.')
          speak('Rest complete. Begin your next set when ready.')
        } else {
          updateStatus('completed')
          setMovementMessage('Session complete. Please share how you felt during the exercise.')
        }
      }
    }, 250)
    return () => window.clearInterval(interval)
  }, [status, restDuration, restPhase, setNumber])

  function startSession() {
    if (!cameraOn || beforeFeeling === null) return
    completionSentRef.current = false
    setDuringFeeling(null)
    setDuringComment('')
    setFeedbackSubmitted(false)
    repDataRef.current = []
    setSetReports([])
    setRepetitions(0)
    setSetNumber(1)
    neutralRef.current = null
    phaseRef.current = 'left'
    frameCountRef.current = 0
    historyRef.current = []
    lastRepTimeRef.current = 0
    updateStatus('exercising')
    setMovementMessage('Sit facing the camera. Hold a comfortable neutral head position for calibration.')
    speak('Your neck side-bend session is starting.')
  }

  function pauseSession() {
    updateStatus('paused')
    frameCountRef.current = 0
    setMovementMessage('Session paused.')
  }

  function resumeSession() {
    phaseRef.current = 'left'
    neutralRef.current = null
    frameCountRef.current = 0
    updateStatus('exercising')
    setMovementMessage('Return to a comfortable neutral position for recalibration.')
  }

  function exitSession() {
    if (statusRef.current === 'exercising' || statusRef.current === 'resting' || statusRef.current === 'paused') {
      saveReport('incomplete')
    }
    window.speechSynthesis?.cancel()
    stopCamera()
    onBack()
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraOn(false)
    if (statusRef.current !== 'completed') updateStatus('ready')
    setTrackingStatus('Camera off')
    setLiveAngle(null)
  }

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), [])


  const progress = (repetitions / TARGET_REPS) * 100
  const latestRecord = repDataRef.current[repDataRef.current.length - 1]

  return (
    <div className="dashboard">
      <header className="app-header">
        <div className="header-brand"><span className="mini-mark">k.</span><span>kinetiq</span></div>
        <button className="logout-button" onClick={exitSession}>Exit session</button>
      </header>
      <main className="session-content">
        <button className="back-link" onClick={exitSession}>← Back to dashboard</button>
        <span className="eyebrow">NECK REHABILITATION</span>
        <h1>Neck Side Bends</h1>
        <p className="session-subtitle">Face the camera with your head and both shoulders visible. Gently tilt toward each shoulder, returning to neutral between sides.</p>

        <section className="patient-feedback-card pre-exercise-feedback" aria-labelledby="before-feedback-title">
          <h2 id="before-feedback-title">How do you feel right now?</h2>
          <p>Choose a number from 0 to 10 for your pain or discomfort.</p>
          <div className="pain-scale" role="group" aria-label="Pain or discomfort before exercise, from zero to ten">
            {Array.from({ length: 11 }, (_, value) => (
              <button key={value} type="button"
                className={`pain-scale-button pain-level-${value}${beforeFeeling === value ? ' selected' : ''}`}
                aria-label={`${value} out of 10`} aria-pressed={beforeFeeling === value}
                onClick={() => setBeforeFeeling(value)}>{value}</button>
            ))}
          </div>
          <div className="pain-scale-anchors" aria-hidden="true">
            <span><strong>0</strong>No pain</span><span><strong>5</strong>Moderate</span><span><strong>10</strong>Worst pain</span>
          </div>
          <label className="feedback-comment-label" htmlFor="before-feedback-comment">
            <strong>Anything else your therapist should know?</strong><span>Optional</span>
          </label>
          <textarea id="before-feedback-comment" className="feedback-comment-input"
            value={beforeComment} onChange={(event) => setBeforeComment(event.target.value)}
            rows={3} placeholder="Example: My neck feels stiff this morning." />
        </section>

        <div className="session-layout">
          <div className="camera-card">
            <div className="camera-heading">
              <div><strong>Live movement tracking</strong><p>Keep your head and both shoulders visible.</p></div>
              <span className={`camera-status ${cameraOn ? 'active' : ''}`}>{cameraOn ? 'Camera connected' : 'Camera off'}</span>
            </div>
            <div className="camera-preview">
              {cameraOn ? (
                <div className="pose-stage">
                  <video ref={videoRef} autoPlay playsInline muted className="camera-video" />
                  <canvas ref={canvasRef} className="pose-canvas" />
                </div>
              ) : (
                <div className="camera-placeholder">
                  <div className="camera-symbol">◎</div>
                  <button type="button" className="preview-enable-button" onClick={startCamera}>Enable camera</button>
                </div>
              )}
            </div>
            <div className="tracking-indicator"><span className="tracking-dot" /><span>{trackingStatus}</span></div>
            {error && <p className="camera-error">{error}</p>}
            {cameraOn && <button className="secondary-action" onClick={stopCamera}>Turn camera off</button>}
          </div>

          <section className="session-analysis-panel session-side-panel">
            <div className="analysis-heading">
              <div><span className="eyebrow">MOVEMENT ANALYSIS</span><h2>Neck Side Bends</h2></div>
              <span className={`camera-status ${status === 'exercising' ? 'active' : ''}`}>
                {status === 'exercising' ? 'Tracking active' : status === 'resting' ? 'Rest period' : status === 'completed' ? 'Complete' : status === 'paused' ? 'Paused' : 'Ready'}
              </span>
            </div>
            <div className="analysis-metrics">
              <div className="analysis-metric"><span>LIVE HEAD TILT</span><strong>{liveAngle !== null ? `${liveAngle.toFixed(1)}°` : '--'}</strong></div>
              <div className="analysis-metric"><span>REPETITIONS</span><strong>{repetitions}/{TARGET_REPS}</strong></div>
              <div className="analysis-metric"><span>SET</span><strong>{setNumber}/{TARGET_SETS}</strong></div>
              <div className="analysis-metric"><span>LEFT TILT</span><strong>{latestRecord ? `${latestRecord.left.toFixed(1)}` : '--'}</strong></div>
              <div className="analysis-metric"><span>RIGHT TILT</span><strong>{latestRecord ? `${latestRecord.right.toFixed(1)}` : '--'}</strong></div>
            </div>
            <p className="analysis-feedback">{movementMessage}</p>
            <div className="analysis-progress"><div style={{ width: `${progress}%` }} /></div>
            {status === 'resting' && <div className="rest-panel">
              <span className="eyebrow">{restPhase === 'set' ? 'REST BETWEEN SETS' : 'POST-EXERCISE RECOVERY'}</span>
              <strong>{restRemaining}s</strong>
              <p>{restPhase === 'set' ? 'Your next set begins automatically when the timer ends.' : 'Your session report will be finalized after recovery.'}</p>
            </div>}
            {status === 'completed' && !feedbackSubmitted && (
              <section className="patient-feedback-card post-exercise-feedback" aria-labelledby="during-feedback-title">
                <h3 id="during-feedback-title">How did you feel during the exercise?</h3>
                <p>Choose a number from 0 to 10 for your pain or discomfort.</p>
                <div className="pain-scale" role="group" aria-label="Pain or discomfort during exercise, from zero to ten">
                  {Array.from({ length: 11 }, (_, value) => (
                    <button key={value} type="button"
                      className={`pain-scale-button pain-level-${value}${duringFeeling === value ? ' selected' : ''}`}
                      aria-label={`${value} out of 10`} aria-pressed={duringFeeling === value}
                      onClick={() => setDuringFeeling(value)}>{value}</button>
                  ))}
                </div>
                <div className="pain-scale-anchors" aria-hidden="true">
                  <span><strong>0</strong>No pain</span><span><strong>5</strong>Moderate</span><span><strong>10</strong>Worst pain</span>
                </div>
                <label className="feedback-comment-label" htmlFor="during-feedback-comment">
                  <strong>Anything else your therapist should know?</strong><span>Optional</span>
                </label>
                <textarea id="during-feedback-comment" className="feedback-comment-input"
                  value={duringComment} onChange={(event) => setDuringComment(event.target.value)}
                  rows={3} placeholder="Example: I felt tightness during the movement." />
                <button className="primary-action" disabled={duringFeeling === null}
                  onClick={() => { setFeedbackSubmitted(true); saveReport('completed') }}>
                  Save feedback and finish
                </button>
              </section>
            )}
            {status === 'completed' && feedbackSubmitted && <p className="analysis-feedback" role="status">Your feedback has been saved for your therapist.</p>}
            <div className="analysis-controls">
              {status === 'ready' && <button className="primary-action" disabled={!cameraOn || beforeFeeling === null} onClick={startSession}>Start</button>}
              {status === 'exercising' && <button className="primary-action" onClick={pauseSession}>Pause session</button>}
              {status === 'paused' && <button className="primary-action" onClick={resumeSession}>Resume session →</button>}
              {status === 'resting' && <button className="primary-action" onClick={pauseSession}>Pause session</button>}
              {status === 'completed' && feedbackSubmitted && <button className="primary-action" onClick={exitSession}>Return to dashboard</button>}
            </div>
          </section>
        </div>

        <aside className="exercise-guide">
          <span className="eyebrow">YOUR MOVEMENT GUIDE</span>
          <h2>How to perform the movement</h2>
          <p className="guide-intro">Sit comfortably with your shoulders relaxed. Gently bring one ear toward the same-side shoulder without lifting the shoulder, return to neutral, then repeat on the other side.</p>
          <div className="movement-diagram" role="img" aria-label="Neck movement guide">
            <div className="diagram-step">
              <svg viewBox="0 0 150 145" aria-hidden="true"><circle cx="75" cy="28" r="17" /><path d="M75 45 L75 102 M75 58 L45 80 M75 58 L105 80 M45 80 L45 116 M105 80 L105 116 M45 116 L105 116" /></svg>
              <strong>1. Left tilt</strong><span>Bring your left ear gently toward your left shoulder.</span>
            </div>
            <div className="diagram-arrow">→</div>
            <div className="diagram-step">
              <svg viewBox="0 0 150 145" aria-hidden="true"><circle cx="75" cy="28" r="17" /><path d="M75 45 L75 102 M75 58 L45 80 M75 58 L105 80 M45 80 L45 116 M105 80 L105 116 M45 116 L105 116" /></svg>
              <strong>2. Right tilt</strong><span>Return to center, then tilt gently to the right.</span>
            </div>
          </div>
          <div className="guide-tip"><strong>Movement quality</strong><p>Move slowly, keep your shoulders relaxed, and do not force your neck beyond a comfortable range.</p></div>
          <div className="camera-position-tip"><span className="eyebrow">CAMERA POSITION</span><p>Place the camera at face height, a few feet away. Face the camera so your head and both shoulders remain visible.</p></div>
          <div className="guide-tip"><strong>OT-prescribed rest</strong><p>{restDuration} seconds between sets and after the exercise.</p></div>
        </aside>

        <p className="demo-note">Experimental 2D webcam movement tracking. These movement proxies are not clinically validated cervical range-of-motion measurements. Camera position, head rotation and landmark visibility can affect readings. Follow your therapist's instructions.</p>
      </main>
    </div>
  )

}

export default NeckSideBends
