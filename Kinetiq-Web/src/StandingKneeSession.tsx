import { useEffect, useRef, useState } from 'react'
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { KneeSessionReport } from './KneeSession'
import './App.css'

type Props = {
  onBack: () => void
  onComplete: (report: KneeSessionReport) => void
}

type Point = { x: number; y: number; visibility?: number; presence?: number }
type Status = 'ready' | 'exercising' | 'resting' | 'paused' | 'completed'

const TARGET_REPS = 10
const TARGET_SETS = 2
const MIN_CONFIDENCE = 0.45
const REQUIRED_FRAMES = 3
const MIN_REP_INTERVAL_MS = 900
const REST_KEY = 'kinetiq.ot.restSeconds'
const REPORTS_KEY = 'kinetiq.sessionReports'

// Fixed demonstration reference: a raise is detected at 170° or lower
// (10° of movement from the 180° reference), and completes on return to 175° or higher.
// These camera-estimated thresholds are not clinical targets.
const STANDING_REFERENCE_DEGREES = 180
const RAISE_MOVEMENT_DEGREES = 10
const RETURN_TOLERANCE_DEGREES = 5
const RAISE_THRESHOLD_DEGREES = STANDING_REFERENCE_DEGREES - RAISE_MOVEMENT_DEGREES // 170°
const RETURN_THRESHOLD_DEGREES = STANDING_REFERENCE_DEGREES - RETURN_TOLERANCE_DEGREES // 175°

function confidence(point?: Point) {
  if (!point) return 0
  const values = [point.visibility, point.presence].filter(
    (value): value is number => typeof value === 'number'
  )
  return values.length ? Math.max(...values) : 0
}

function angleAtJoint(a: Point, b: Point, c: Point) {
  const radians =
    Math.atan2(c.y - b.y, c.x - b.x) -
    Math.atan2(a.y - b.y, a.x - b.x)
  let degrees = Math.abs(radians * (180 / Math.PI))
  if (degrees > 180) degrees = 360 - degrees
  return Math.round(degrees)
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function restSeconds() {
  const value = Number(localStorage.getItem(REST_KEY) || 45)
  return Number.isFinite(value) ? Math.max(5, Math.min(300, value)) : 45
}

function painLabel(score: number) {
  if (score === 0) return 'No pain'
  if (score <= 2) return 'Mild'
  if (score <= 4) return 'Moderate'
  if (score <= 7) return 'Severe'
  if (score <= 9) return 'Very severe'
  return 'Worst pain'
}

export default function StandingKneeSession({ onBack, onComplete }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const landmarkerRef = useRef<PoseLandmarker | null>(null)
  const statusRef = useRef<Status>('ready')
  const phaseRef = useRef<'standing' | 'raised'>('standing')
  const selectedSideRef = useRef<number[] | null>(null)
  const angleHistoryRef = useRef<number[]>([])
  const raiseFramesRef = useRef(0)
  const returnFramesRef = useRef(0)
  const lastRepTimeRef = useRef(0)
  const peakRef = useRef(0)
  const repAnglesRef = useRef<number[]>([])
  const reportsRef = useRef<KneeSessionReport['sets']>([])
  const completedRef = useRef(false)
  const setRef = useRef(1)

  const [cameraOn, setCameraOn] = useState(false)
  const [status, setStatus] = useState<Status>('ready')
  const [beforeFeeling, setBeforeFeeling] = useState<number | null>(null)
  const [beforeComment, setBeforeComment] = useState('')
  const [duringFeeling, setDuringFeeling] = useState<number | null>(null)
  const [duringComment, setDuringComment] = useState('')
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false)
  const [tracking, setTracking] = useState('Waiting for camera')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('Stand sideways to the camera with your full upper body and legs visible.')
  const [hipAngle, setHipAngle] = useState<number | null>(null)
  const [sideLabel, setSideLabel] = useState('Not selected')
  const [reps, setReps] = useState(0)
  const [setNumber, setSetNumber] = useState(1)
  const [repAngles, setRepAngles] = useState<number[]>([])
  const [setReports, setSetReports] = useState<KneeSessionReport['sets']>([])
  const [restPhase, setRestPhase] = useState<'set' | 'exercise'>('set')
  const restDuration = useRef(restSeconds()).current
  const [restRemaining, setRestRemaining] = useState(restDuration)

  function updateStatus(next: Status) {
    statusRef.current = next
    setStatus(next)
  }

  function resetSmoothing() {
    angleHistoryRef.current = []
    raiseFramesRef.current = 0
    returnFramesRef.current = 0
    peakRef.current = 0
  }

  async function startCamera() {
    setError('')
    setTracking('Connecting camera')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      setCameraOn(true)
    } catch {
      setTracking('Camera unavailable')
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
    let frame = 0
    let landmarker: PoseLandmarker | null = null

    async function initialize() {
      try {
        setTracking('Loading pose detection')
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        )
        if (cancelled) return
        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        })
        if (cancelled) {
          landmarker.close()
          return
        }
        landmarkerRef.current = landmarker
        const video = videoRef.current
        const canvas = canvasRef.current
        if (!video || !canvas) throw new Error('Camera preview not found.')
        await video.play()
        setTracking('Looking for your body')

        function detect() {
          if (cancelled || !video || !canvas || !landmarker || video.readyState < 2) {
            if (!cancelled) frame = requestAnimationFrame(detect)
            return
          }
          const width = video.videoWidth
          const height = video.videoHeight
          if (!width || !height) {
            frame = requestAnimationFrame(detect)
            return
          }
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width
            canvas.height = height
          }
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          ctx.clearRect(0, 0, width, height)

          try {
            const result = landmarker.detectForVideo(video, performance.now())
            if (result.landmarks.length) {
              const points = result.landmarks[0] as Point[]
              setTracking('Body detected')

              // Draw shoulder, hip, knee and the rest of the visible pose.
              const links = [
                [11, 12], [11, 23], [12, 24], [23, 24],
                [23, 25], [25, 27], [24, 26], [26, 28],
                [11, 13], [13, 15], [12, 14], [14, 16],
              ]
              ctx.strokeStyle = '#D8C4A8'
              ctx.lineWidth = Math.max(3, width / 250)
              ctx.lineCap = 'round'
              links.forEach(([a, b]) => {
                if (confidence(points[a]) < 0.3 || confidence(points[b]) < 0.3) return
                ctx.beginPath()
                ctx.moveTo(points[a].x * width, points[a].y * height)
                ctx.lineTo(points[b].x * width, points[b].y * height)
                ctx.stroke()
              })
              points.forEach((point) => {
                if (confidence(point) < 0.3) return
                ctx.beginPath()
                ctx.arc(point.x * width, point.y * height, Math.max(4, width / 180), 0, Math.PI * 2)
                ctx.fillStyle = '#FFFFFF'
                ctx.fill()
                ctx.lineWidth = 2
                ctx.strokeStyle = '#A39788'
                ctx.stroke()
              })

              // Lock onto the more visible side once the patient starts.
              if (statusRef.current === 'exercising' && !selectedSideRef.current) {
                const left = Math.min(confidence(points[11]), confidence(points[23]), confidence(points[25]))
                const right = Math.min(confidence(points[12]), confidence(points[24]), confidence(points[26]))
                if (Math.max(left, right) >= MIN_CONFIDENCE) {
                  const isLeft = left >= right
                  selectedSideRef.current = isLeft ? [11, 23, 25] : [12, 24, 26]
                  setSideLabel(isLeft ? 'Left side' : 'Right side')
                  setTracking(`${isLeft ? 'Left' : 'Right'} side locked`)
                  setMessage('Side detected. Begin standing comfortably with your knee relaxed.')
                  resetSmoothing()
                } else {
                  setTracking('Waiting for shoulder, hip and knee')
                  setMessage('Move farther into view so your shoulder, hip and knee are visible.')
                }
              }

              if (selectedSideRef.current) {
                const [shoulderIndex, hipIndex, kneeIndex] = selectedSideRef.current
                const shoulder = points[shoulderIndex]
                const hip = points[hipIndex]
                const knee = points[kneeIndex]
                const visible = Math.min(confidence(shoulder), confidence(hip), confidence(knee))
                if (visible < MIN_CONFIDENCE) {
                  setHipAngle(null)
                  setTracking('Leg temporarily out of view')
                  if (statusRef.current === 'exercising') {
                    phaseRef.current = 'standing'
                    resetSmoothing()
                    setMessage('Tracking paused. Bring your shoulder, hip and knee back into view.')
                  }
                } else {
                  const raw = angleAtJoint(shoulder, hip, knee)
                  if (!Number.isFinite(raw) || raw < 45 || raw > 180) {
                    setHipAngle(null)
                    setTracking('Unreliable angle — reposition')
                    resetSmoothing()
                  } else {
                    angleHistoryRef.current = [...angleHistoryRef.current.slice(-4), raw]
                    const angle = median(angleHistoryRef.current)
                    setHipAngle(angle)

                    if (statusRef.current === 'exercising' && angleHistoryRef.current.length >= 3) {
                      const now = performance.now()
                      if (phaseRef.current === 'standing') {
                        raiseFramesRef.current = angle <= RAISE_THRESHOLD_DEGREES ? raiseFramesRef.current + 1 : 0
                        if (raiseFramesRef.current >= REQUIRED_FRAMES && now - lastRepTimeRef.current > MIN_REP_INTERVAL_MS) {
                          phaseRef.current = 'raised'
                          peakRef.current = angle
                          raiseFramesRef.current = 0
                          setMessage('Knee raise detected. Slowly lower your foot to standing.')
                        }
                      } else {
                        peakRef.current = Math.min(peakRef.current || angle, angle)
                        returnFramesRef.current = angle >= RETURN_THRESHOLD_DEGREES ? returnFramesRef.current + 1 : 0
                        if (returnFramesRef.current >= REQUIRED_FRAMES && repAnglesRef.current.length < TARGET_REPS) {
                          phaseRef.current = 'standing'
                          lastRepTimeRef.current = now
                          returnFramesRef.current = 0
                          const nextAngles = [...repAnglesRef.current, peakRef.current]
                          repAnglesRef.current = nextAngles
                          setRepAngles(nextAngles)
                          setReps(nextAngles.length)
                          setMessage(`Repetition ${nextAngles.length} recorded. Return to a comfortable standing position.`)

                          if (nextAngles.length >= TARGET_REPS) {
                            const currentSet = setRef.current
                            const best = Math.min(...nextAngles)
                            const average = Math.round(nextAngles.reduce((sum, value) => sum + value, 0) / nextAngles.length)
                            const setReport = {
                              setNumber: currentSet,
                              repetitions: nextAngles.length,
                              angles: nextAngles,
                              bestAngle: best,
                              averageAngle: average,
                              targetRepetitions: TARGET_REPS,
                            }
                            reportsRef.current = [...reportsRef.current.filter((item) => item.setNumber !== currentSet), setReport]
                            setSetReports(reportsRef.current)
                            const nextPhase = currentSet < TARGET_SETS ? 'set' : 'exercise'
                            setRestPhase(nextPhase)
                            updateStatus('resting')
                            setMessage(nextPhase === 'set' ? 'Set complete. Rest period started.' : 'Exercise complete. Final recovery period started.')
                          }
                          peakRef.current = 0
                        }
                      }
                    }
                  }
                }
              }
            } else {
              setTracking('No body detected')
              setHipAngle(null)
              if (statusRef.current === 'exercising') {
                phaseRef.current = 'standing'
                resetSmoothing()
                setMessage('Move into view of the camera.')
              }
            }
          } catch (err) {
            console.error('Pose detection error:', err)
            setTracking('Tracking paused')
          }
          frame = requestAnimationFrame(detect)
        }
        detect()
      } catch (err) {
        console.error('MediaPipe initialization error:', err)
        if (!cancelled) {
          setTracking('Tracking unavailable')
          setError('Unable to load pose detection. Check your internet connection and try again.')
        }
      }
    }
    initialize()
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      landmarker?.close()
      landmarkerRef.current = null
      const ctx = canvasRef.current?.getContext('2d')
      if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    }
  }, [cameraOn])

  function saveReport(reportStatus: 'completed' | 'incomplete' = 'completed') {
    if (completedRef.current) return
    completedRef.current = true
    const sets = [...reportsRef.current]
    const currentSaved = sets.some((item) => item.setNumber === setNumber)
    const angles = sets.flatMap((item) => item.angles)
    if (!currentSaved) angles.push(...repAnglesRef.current)
    const report: KneeSessionReport = {
      id: `standing-knee-${Date.now()}`,
      patientName: 'Knee Baby',
      exercise: 'Standing knee raise',
      completedAt: new Date().toISOString(),
      status: reportStatus,
      targetRepetitionsPerSet: TARGET_REPS,
      targetSets: TARGET_SETS,
      // Existing report schema names are retained for OT dashboard compatibility.
      // These values represent estimated hip angle, not knee extension.
      extensionThresholdDegrees: RAISE_THRESHOLD_DEGREES,
      returnThresholdDegrees: RETURN_THRESHOLD_DEGREES,
      restSeconds: restDuration,
      totalRepetitions: angles.length,
      bestExtensionAngle: angles.length ? Math.min(...angles) : null,
      averageExtensionAngle: angles.length
        ? Math.round(angles.reduce((sum, value) => sum + value, 0) / angles.length)
        : null,
      sets,
      repAngles: angles,
      dataQualityNote: 'Angles are 2D webcam estimates of the hip angle, not clinically validated measurements. Camera position, occlusion, body orientation and landmark quality affect readings.',
      patientFeedback: {
        before: { rating: beforeFeeling, label: beforeFeeling === null ? 'Not provided' : painLabel(beforeFeeling), comment: beforeComment },
        during: { rating: duringFeeling, label: duringFeeling === null ? 'Not provided' : painLabel(duringFeeling), comment: duringComment },
      },
      aiAnalysisInput: {
        purpose: 'Provide an OT-facing descriptive summary of this demonstration session, not a diagnosis or treatment recommendation.',
        priorityPatientFeedback: {
          beforeExercise: { rating: beforeFeeling, label: beforeFeeling === null ? 'Not provided' : painLabel(beforeFeeling), comment: beforeComment },
          duringExercise: { rating: duringFeeling, label: duringFeeling === null ? 'Not provided' : painLabel(duringFeeling), comment: duringComment },
          interpretation: "Treat patient-reported feelings and comments as high-priority context for OT review. Report them clearly, compare before and during ratings, and do not infer a diagnosis from the patient's self-reported pain or discomfort rating.",
        },
        metrics: ['completed repetitions', 'per-repetition estimated hip angle at the raised position', 'estimated movement from the 180-degree reference (180 minus the recorded raised hip angle)', 'per-set best and average estimated hip angle', 'raise detection threshold: 170 degrees or lower', 'return threshold: 175 degrees or higher', 'completed sets', 'data quality limitations'],
        instruction: 'Lead the summary with the patient-reported before and during exercise feedback. Highlight any lower rating or discomfort comment for OT review. Then describe observed repetition count, recorded raised hip angles, estimated movement from the 180-degree reference, and consistency across repetitions. Explain that angles are 2D webcam estimates and are not clinically validated. Do not infer pain, strength, diagnosis or clinical range of motion.',
      },
    }
    try {
      const previous = JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]')
      localStorage.setItem(REPORTS_KEY, JSON.stringify([...previous, report]))
    } catch (err) {
      console.error('Unable to save standing knee report:', err)
    }
    onComplete(report)
  }

  useEffect(() => {
    if (status !== 'resting') return
    setRestRemaining(restDuration)
    const end = Date.now() + restDuration * 1000
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000))
      setRestRemaining(remaining)
      if (remaining <= 0) {
        window.clearInterval(timer)
        if (restPhase === 'set' && setNumber < TARGET_SETS) {
          const nextSet = setNumber + 1
          setSetNumber(nextSet)
          setRef.current = nextSet
          setReps(0)
          repAnglesRef.current = []
          setRepAngles([])
          phaseRef.current = 'standing'
          lastRepTimeRef.current = 0
          resetSmoothing()
          updateStatus('exercising')
          setMessage('Rest complete. Begin the next set when ready.')
        } else {
          updateStatus('completed')
          setMessage('Exercise complete. Please share how you felt during the exercise.')
        }
      }
    }, 250)
    return () => window.clearInterval(timer)
  }, [status, restDuration, restPhase, setNumber])

  function startSession() {
    if (!cameraOn || beforeFeeling === null) return
    completedRef.current = false
    setDuringFeeling(null)
    setDuringComment('')
    setFeedbackSubmitted(false)
    repAnglesRef.current = []
    reportsRef.current = []
    setSetReports([])
    setRepAngles([])
    setReps(0)
    setSetNumber(1)
    setRef.current = 1
    selectedSideRef.current = null
    setSideLabel('Waiting for side')
    phaseRef.current = 'standing'
    lastRepTimeRef.current = 0
    resetSmoothing()
    updateStatus('exercising')
    setTracking('Waiting for shoulder, hip and knee')
    setMessage('Session started. Stand sideways to the camera with your full body visible.')
  }

  function pauseSession() {
    updateStatus('paused')
    resetSmoothing()
    setMessage('Session paused.')
  }

  function resumeSession() {
    phaseRef.current = 'standing'
    resetSmoothing()
    updateStatus('exercising')
    setMessage('Ready to continue. Start from a comfortable standing position.')
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraOn(false)
    selectedSideRef.current = null
    setSideLabel('Not selected')
    setHipAngle(null)
    setTracking('Camera off')
    resetSmoothing()
    if (statusRef.current !== 'completed') updateStatus('ready')
  }

  function exitSession() {
    if (statusRef.current === 'exercising' || statusRef.current === 'resting' || statusRef.current === 'paused') {
      saveReport('incomplete')
    }
    stopCamera()
    onBack()
  }

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    landmarkerRef.current?.close()
  }, [])

  const progress = (reps / TARGET_REPS) * 100
  const allAngles = [...setReports.flatMap((item) => item.angles), ...repAngles]

  return (
    <div className="dashboard">
      <header className="app-header">
        <div className="header-brand"><span className="mini-mark">k.</span><span>kinetiq</span></div>
        <button className="logout-button" onClick={exitSession}>Exit session</button>
      </header>

      <main className="session-content">
        <button className="back-link" onClick={exitSession}>← Back to dashboard</button>
        <span className="eyebrow">KNEE REHABILITATION</span>
        <h1>Standing knee raises</h1>
        <p className="session-subtitle">Stand side-on to the camera with your shoulder, hip and knee visible. A raise is detected at 170° or lower, then counted when you return to 175° or higher. Use a stable support if needed.</p>

        <section className="patient-feedback-card pre-exercise-feedback" aria-labelledby="before-feedback-title">
          <h2 id="before-feedback-title">How do you feel right now?</h2>
          <p>Choose a number from 0 to 10 for your pain or discomfort.</p>
          <div className="pain-scale" role="group" aria-label="Pain or discomfort before exercise, from zero to ten">
            {Array.from({ length: 11 }, (_, value) => (
              <button
                key={value}
                type="button"
                className={`pain-scale-button pain-level-${value}${beforeFeeling === value ? ' selected' : ''}`}
                aria-label={`${value} out of 10`}
                aria-pressed={beforeFeeling === value}
                onClick={() => setBeforeFeeling(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="pain-scale-anchors" aria-hidden="true">
            <span><strong>0</strong>No pain</span>
            <span><strong>5</strong>Moderate</span>
            <span><strong>10</strong>Worst pain</span>
          </div>
          <label className="feedback-comment-label" htmlFor="before-feedback-comment">
            <strong>Anything else your therapist should know?</strong>
            <span>Optional</span>
          </label>
          <textarea
            id="before-feedback-comment"
            className="feedback-comment-input"
            value={beforeComment}
            onChange={(event) => setBeforeComment(event.target.value)}
            rows={3}
            placeholder="Example: My knee feels stiff this morning."
          />
        </section>
        <div className="session-layout">
          <div className="camera-card">
            <div className="camera-heading">
              <div><strong>Live movement tracking</strong><p>Keep your shoulder, hip and knee visible.</p></div>
              <span className={`camera-status ${cameraOn ? 'active' : ''}`}>{cameraOn ? 'Camera connected' : 'Camera off'}</span>
            </div>
            <div className="camera-preview">
              {cameraOn ? (
                <div className="pose-stage">
                  <video ref={videoRef} autoPlay playsInline muted className="camera-video" />
                  <canvas ref={canvasRef} className="pose-canvas" />
                </div>
              ) : (
                <div className="camera-placeholder"><button type="button" className="preview-enable-button" onClick={startCamera}>Enable camera</button></div>
              )}
            </div>
            <div className="tracking-indicator"><span className="tracking-dot" /><span>{tracking}</span>{status === 'exercising' && <span> · {sideLabel}</span>}</div>
            {error && <p className="camera-error">{error}</p>}
            {cameraOn && <button className="secondary-action" onClick={stopCamera}>Turn camera off</button>}
          </div>

          <section className="session-analysis-panel session-side-panel">
            <div className="analysis-heading">
              <div><span className="eyebrow">MOVEMENT ANALYSIS</span><h2>Standing knee raise</h2></div>
              <span className={`camera-status ${status === 'exercising' ? 'active' : ''}`}>{status === 'exercising' ? 'Tracking active' : status === 'resting' ? 'Rest period' : status === 'completed' ? 'Complete' : status === 'paused' ? 'Paused' : 'Ready'}</span>
            </div>
            <div className="analysis-metrics">
              <div className="analysis-metric"><span>LIVE HIP ANGLE</span><strong>{hipAngle !== null ? `${hipAngle}°` : '--'}</strong></div>
              <div className="analysis-metric"><span>REPETITIONS</span><strong>{reps}/{TARGET_REPS}</strong></div>
              <div className="analysis-metric"><span>SET</span><strong>{setNumber}/{TARGET_SETS}</strong></div>
            </div>
            <p className="analysis-feedback">{message}</p>
            <div className="analysis-progress"><div style={{ width: `${progress}%` }} /></div>
            {status === 'resting' && <div className="rest-panel"><span className="eyebrow">{restPhase === 'set' ? 'REST BETWEEN SETS' : 'POST-EXERCISE RECOVERY'}</span><strong>{restRemaining}s</strong><p>{restPhase === 'set' ? 'Your next set begins automatically when the timer ends.' : 'Your session report will be finalized when recovery ends.'}</p></div>}
            {status === 'completed' && !feedbackSubmitted && (
              <section className="patient-feedback-card post-exercise-feedback" aria-labelledby="during-feedback-title">
              <h3 id="during-feedback-title">How did you feel during the exercise?</h3>
              <p>Choose a number from 0 to 10 for your pain or discomfort.</p>
              <div className="pain-scale" role="group" aria-label="Pain or discomfort during exercise, from zero to ten">
                {Array.from({ length: 11 }, (_, value) => (
                  <button
                    key={value}
                    type="button"
                    className={`pain-scale-button pain-level-${value}${duringFeeling === value ? ' selected' : ''}`}
                    aria-label={`${value} out of 10`}
                    aria-pressed={duringFeeling === value}
                    onClick={() => setDuringFeeling(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <div className="pain-scale-anchors" aria-hidden="true">
                <span><strong>0</strong>No pain</span>
                <span><strong>5</strong>Moderate</span>
                <span><strong>10</strong>Worst pain</span>
              </div>
              <label className="feedback-comment-label" htmlFor="during-feedback-comment">
                <strong>Anything else your therapist should know?</strong>
                <span>Optional</span>
              </label>
              <textarea
                id="during-feedback-comment"
                className="feedback-comment-input"
                value={duringComment}
                onChange={(event) => setDuringComment(event.target.value)}
                rows={3}
                placeholder="Example: My knee felt sore when I straightened it."
              />
              <button className="primary-action" disabled={duringFeeling === null} onClick={() => { setFeedbackSubmitted(true); saveReport('completed') }}>
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
          <p className="guide-intro">Stand comfortably beside a stable support. Lift one knee only within the range prescribed by your therapist, then lower your foot with control.</p>
          <div className="guide-tip"><strong>Camera position</strong><p>Place the camera far enough away to capture your shoulder, hip, knee and ankle. Stand side-on to the camera.</p></div>
          <div className="guide-tip"><strong>Movement quality</strong><p>Keep your torso steady, use support as needed, and avoid forcing the movement. Stop if you experience pain.</p></div>
          <div className="guide-tip"><strong>OT-prescribed rest</strong><p>{restDuration} seconds between sets and after the exercise.</p></div>
        </aside>

        <p className="demo-note">Experimental movement tracking. Hip angles are estimated from a 2D webcam view and are not clinically validated. Camera position and landmark quality affect measurements. Follow the therapist's instructions.</p>
      </main>
    </div>
  )
}
