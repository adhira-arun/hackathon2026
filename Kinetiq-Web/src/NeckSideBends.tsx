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
  aiAnalysisInput: {
    purpose: string
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
  // Head roll relative to the horizontal image axis. Neutral is calibrated at session start.
  return Math.atan2(rightEar.y - leftEar.y, rightEar.x - leftEar.x) * 180 / Math.PI
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
      aiAnalysisInput: {
        purpose: 'Provide an OT-facing descriptive summary of observed neck side-bend movement, not a diagnosis or treatment recommendation.',
        metrics: ['completed repetitions', 'left tilt movement proxy per rep', 'right tilt movement proxy per rep', 'left/right consistency', 'set-by-set performance', 'data quality limitations'],
        instruction: 'Describe observed movement trends and measurement limitations. Do not infer pain, strength, diagnosis, or clinical range of motion.',
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
          setMovementMessage('Session complete. Your report is ready.')
          saveReport()
        }
      }
    }, 250)
    return () => window.clearInterval(interval)
  }, [status, restDuration, restPhase, setNumber])

  function startSession() {
    if (!cameraOn) return
    completionSentRef.current = false
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

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraOn(false)
    if (statusRef.current !== 'completed') updateStatus('ready')
    setTrackingStatus('Camera off')
    setLiveAngle(null)
  }

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), [])

  return (
    <div className="dashboard session-dashboard">
      <header className="app-header">
        <div className="header-brand"><span className="mini-mark">k.</span><span>kinetiq</span></div>
        <button className="logout-button" onClick={onBack}>← Back to dashboard</button>
      </header>
      <main className="dashboard-content session-content">
        <span className="eyebrow">CAMERA-TRACKED EXERCISE</span>
        <h2>Neck Side Bends</h2>
        <p className="dashboard-subtitle">Gently tilt toward each shoulder, returning to neutral between sides.</p>
        <div className="session-layout">
          <section className="session-camera-panel">
            <div className="camera-preview">
              <div className="pose-stage">
                <video ref={videoRef} autoPlay muted playsInline className="camera-video" />
                <canvas ref={canvasRef} className="pose-canvas" />
              </div>
            </div>
            <div className="tracking-indicator"><span className="tracking-dot" /><span>{trackingStatus}</span></div>
            {error && <p className="camera-error">{error}</p>}
            {!cameraOn ? <button className="primary-action" onClick={startCamera}>Enable camera →</button> : <button className="secondary-action" onClick={stopCamera}>Turn camera off</button>}
          </section>
          <section className="session-analysis-panel session-side-panel">
            <div className="analysis-heading">
              <div><span className="eyebrow">MOVEMENT ANALYSIS</span><h2>Live tracking</h2></div>
              <span className={`camera-status ${status === 'exercising' ? 'active' : ''}`}>{status}</span>
            </div>
            <div className="analysis-metrics">
              <div className="analysis-metric"><span>LIVE HEAD TILT</span><strong>{liveAngle !== null ? `${liveAngle.toFixed(1)}°` : '--'}</strong></div>
              <div className="analysis-metric"><span>REPETITIONS</span><strong>{repetitions}/{TARGET_REPS}</strong></div>
              <div className="analysis-metric"><span>SET</span><strong>{setNumber}/{TARGET_SETS}</strong></div>
              <div className="analysis-metric"><span>LEFT TILT</span><strong>{repDataRef.current.length ? `${repDataRef.current[repDataRef.current.length - 1].left.toFixed(1)}°` : '--'}</strong></div>
              <div className="analysis-metric"><span>RIGHT TILT</span><strong>{repDataRef.current.length ? `${repDataRef.current[repDataRef.current.length - 1].right.toFixed(1)}°` : '--'}</strong></div>
            </div>
            <p className="analysis-feedback">{movementMessage}</p>
            {status === 'resting' && <div className="rest-panel"><span className="eyebrow">REST PERIOD</span><strong>{restRemaining}s</strong></div>}
            {status === 'completed' && <p className="analysis-feedback">Session report saved for OT review.</p>}
            <div className="analysis-controls">
              {status === 'ready' && <button className="primary-action" disabled={!cameraOn} onClick={startSession}>Start exercise session →</button>}
              {status === 'exercising' && <button className="primary-action" onClick={pauseSession}>Pause session</button>}
              {status === 'paused' && <button className="primary-action" onClick={resumeSession}>Resume session</button>}
              {status !== 'ready' && status !== 'completed' && <button className="secondary-action" onClick={() => saveReport('incomplete')}>End session</button>}
            </div>
          </section>
        </div>
        <p className="demo-note">Experimental 2D webcam movement tracking, not a clinically validated cervical range-of-motion measurement. Move gently and follow the therapist's prescribed range.</p>
      </main>
    </div>
  )
}

export default NeckSideBends
