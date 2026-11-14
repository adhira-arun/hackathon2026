
import { useEffect, useRef, useState } from 'react'
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import './App.css'

type KneeSessionProps = {
  onBack: () => void
  onComplete: (report: KneeSessionReport) => void
}

type SessionStatus =
  | 'ready'
  | 'exercising'
  | 'resting'
  | 'completed'
  | 'paused'

type SetReport = {
  setNumber: number
  repetitions: number
  angles: number[]
  bestAngle: number | null
  averageAngle: number | null
  targetRepetitions: number
}

export type KneeSessionReport = {
  id: string
  patientName: string
  exercise: string
  completedAt: string
  status: 'completed' | 'incomplete'
  targetRepetitionsPerSet: number
  targetSets: number
  extensionThresholdDegrees: number
  returnThresholdDegrees: number
  restSeconds: number
  totalRepetitions: number
  bestExtensionAngle: number | null
  averageExtensionAngle: number | null
  sets: SetReport[]
  repAngles: number[]
  dataQualityNote: string
  aiAnalysisInput: {
    purpose: string
    metrics: string[]
    instruction: string
  }
}

type PosePoint = {
  x: number
  y: number
  visibility?: number
  presence?: number
}

const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [27, 29], [29, 31], [24, 26], [26, 28], [28, 30], [30, 32],
]

const TARGET_REPS = 10
const TARGET_SETS = 2

// Initial demonstration thresholds. Validate against live readings before relying on them.
const EXTENSION_THRESHOLD = 111
const RETURN_THRESHOLD = 110

// Require several consistent frames to avoid false repetitions.
const REQUIRED_EXTENSION_FRAMES = 3
const REQUIRED_RETURN_FRAMES = 3
const MIN_VISIBILITY = 0.35
const MIN_REP_INTERVAL_MS = 1000

const REST_SETTING_KEY = 'kinetiq.ot.restSeconds'
const REPORTS_KEY = 'kinetiq.sessionReports'

function calculateAngle(
  a: PosePoint,
  b: PosePoint,
  c: PosePoint
): number {
  const radians =
    Math.atan2(c.y - b.y, c.x - b.x) -
    Math.atan2(a.y - b.y, a.x - b.x)

  let degrees = Math.abs(radians * (180 / Math.PI))

  if (degrees > 180) {
    degrees = 360 - degrees
  }

  return Math.round(degrees)
}

function speak(message: string) {
  if (!('speechSynthesis' in window)) return

  window.speechSynthesis.cancel()

  const utterance = new SpeechSynthesisUtterance(message)
  utterance.rate = 0.95

  window.speechSynthesis.speak(utterance)
}

function safeReadRestSeconds() {
  const value = Number(
    localStorage.getItem(REST_SETTING_KEY) || 45
  )

  return Number.isFinite(value)
    ? Math.max(5, Math.min(300, value))
    : 45
}

function getMedian(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

// MediaPipe may provide visibility and presence confidence separately.
// Use whichever signal is available instead of treating a missing visibility
// field as zero confidence.
function getLandmarkConfidence(point: PosePoint | undefined) {
  if (!point) return 0
  const values = [point.visibility, point.presence].filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value)
  )
  return values.length ? Math.max(...values) : 0
}

function KneeSession({ onBack, onComplete }: KneeSessionProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const landmarkerRef = useRef<PoseLandmarker | null>(null)

  const phaseRef = useRef<'bent' | 'extended'>('bent')
  const peakAngleRef = useRef(0)
  const lastRepTimeRef = useRef(0)

  const sessionStatusRef = useRef<SessionStatus>('ready')
  const repAnglesRef = useRef<number[]>([])
  const completionSentRef = useRef(false)

  // Tracking stability refs
  const latestLandmarksRef = useRef<PosePoint[] | null>(null)
  const trackedLegRef = useRef<number[] | null>(null)
  const angleHistoryRef = useRef<number[]>([])
  const extensionFramesRef = useRef(0)
  const returnFramesRef = useRef(0)
  const setNumberRef = useRef(1)

  const [cameraOn, setCameraOn] = useState(false)
  const [trackingStatus, setTrackingStatus] = useState('Waiting for camera')
  const [error, setError] = useState('')
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('ready')

  const [repetitions, setRepetitions] = useState(0)
  const [setNumber, setSetNumber] = useState(1)
  const [kneeAngle, setKneeAngle] = useState<number | null>(null)
  const [trackedLegLabel, setTrackedLegLabel] = useState('Not selected')

  const [restDuration] = useState(safeReadRestSeconds)
  const [restRemaining, setRestRemaining] = useState(safeReadRestSeconds)

  const [movementMessage, setMovementMessage] = useState(
    'Position yourself sideways to the camera.'
  )

  const [repAngles, setRepAngles] = useState<number[]>([])
  const [setReports, setSetReports] = useState<SetReport[]>([])
  const [restPhase, setRestPhase] = useState<'set' | 'exercise'>('set')

  // Keep the current set number available to the camera callback.
  setNumberRef.current = setNumber

  function updateStatus(status: SessionStatus) {
    sessionStatusRef.current = status
    setSessionStatus(status)
  }

  function resetTrackingCounters() {
    angleHistoryRef.current = []
    extensionFramesRef.current = 0
    returnFramesRef.current = 0
    peakAngleRef.current = 0
  }

  // A tracking interruption must never complete a repetition.
  function resetMovementPhaseAfterTrackingLoss() {
    phaseRef.current = 'bent'
    resetTrackingCounters()
  }

  function chooseVisibleLeg(landmarks: PosePoint[]) {
    const leftVisibility = Math.min(
      getLandmarkConfidence(landmarks[23]),
      getLandmarkConfidence(landmarks[25]),
      getLandmarkConfidence(landmarks[27])
    )

    const rightVisibility = Math.min(
      getLandmarkConfidence(landmarks[24]),
      getLandmarkConfidence(landmarks[26]),
      getLandmarkConfidence(landmarks[28])
    )

    if (Math.max(leftVisibility, rightVisibility) < MIN_VISIBILITY) {
      return null
    }

    return leftVisibility >= rightVisibility
      ? { indices: [23, 25, 27], label: 'Left leg' }
      : { indices: [24, 26, 28], label: 'Right leg' }
  }

  async function startCamera() {
    setError('')
    setTrackingStatus('Connecting camera')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })

      streamRef.current = stream
      setCameraOn(true)
    } catch {
      setTrackingStatus('Camera unavailable')
      setError(
        'Camera access unavailable. Please allow camera permission and try again.'
      )
    }
  }

  // Attach the webcam stream to the video element.
  useEffect(() => {
    if (cameraOn && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.play().catch(() => {
        setError('Unable to start the camera preview.')
      })
    }
  }, [cameraOn])

  // Initialize MediaPipe and continuously detect body landmarks.
  useEffect(() => {
    if (!cameraOn) return

    let animationFrame = 0
    let cancelled = false
    let landmarker: PoseLandmarker | null = null

    async function initializeTracking() {
      try {
        setTrackingStatus('Loading pose detection model')

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

        if (!video || !canvas) {
          throw new Error('Camera preview could not be found.')
        }

        await video.play()
        setTrackingStatus('Looking for your body')

        function detectPose() {
          if (
            cancelled ||
            !video ||
            !canvas ||
            !landmarker ||
            video.readyState < 2
          ) {
            if (!cancelled) {
              animationFrame = requestAnimationFrame(detectPose)
            }
            return
          }

          const width = video.videoWidth
          const height = video.videoHeight

          if (!width || !height) {
            animationFrame = requestAnimationFrame(detectPose)
            return
          }

          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width
            canvas.height = height
          }

          const context = canvas.getContext('2d')
          if (!context) return

          context.clearRect(0, 0, width, height)

          try {
            const results = landmarker.detectForVideo(
              video,
              performance.now()
            )

            if (results.landmarks.length > 0) {
              const landmarks = results.landmarks[0] as PosePoint[]

              latestLandmarksRef.current = landmarks
              setTrackingStatus('Body detected')

              // Draw skeleton.
              context.strokeStyle = '#D8C4A8'
              context.lineWidth = Math.max(3, width / 250)
              context.lineCap = 'round'

              CONNECTIONS.forEach(([start, end]) => {
                const first = landmarks[start]
                const second = landmarks[end]

                if (
                  getLandmarkConfidence(first) < 0.3 ||
                  getLandmarkConfidence(second) < 0.3
                ) {
                  return
                }

                context.beginPath()
                context.moveTo(first.x * width, first.y * height)
                context.lineTo(second.x * width, second.y * height)
                context.stroke()
              })

              landmarks.forEach((point) => {
                if (getLandmarkConfidence(point) < 0.3) return

                context.beginPath()
                context.arc(
                  point.x * width,
                  point.y * height,
                  Math.max(4, width / 180),
                  0,
                  Math.PI * 2
                )

                context.fillStyle = '#FFFFFF'
                context.fill()
                context.lineWidth = 2
                context.strokeStyle = '#A39788'
                context.stroke()
              })

              // Select a leg once landmarks are sufficiently visible.
              // The selection stays locked for the entire session.
              if (
                sessionStatusRef.current === 'exercising' &&
                trackedLegRef.current === null
              ) {
                const selectedLeg = chooseVisibleLeg(landmarks)

                if (selectedLeg) {
                  trackedLegRef.current = selectedLeg.indices
                  setTrackedLegLabel(selectedLeg.label)
                  setTrackingStatus(`${selectedLeg.label} locked`)
                  setMovementMessage(
                    `${selectedLeg.label} detected. Begin with your knee comfortably bent.`
                  )
                  resetMovementPhaseAfterTrackingLoss()
                } else {
                  setTrackingStatus('Waiting for hip, knee and ankle')
                  setKneeAngle(null)
                  setMovementMessage(
                    'Move slightly farther into view so your hip, knee and ankle are visible.'
                  )
                }
              }

              const selectedLeg = trackedLegRef.current

              if (!selectedLeg) {
                setKneeAngle(null)
              } else {
                const [hip, knee, ankle] = selectedLeg
                const hipPoint = landmarks[hip]
                const kneePoint = landmarks[knee]
                const anklePoint = landmarks[ankle]

                const visibility = Math.min(
                  getLandmarkConfidence(hipPoint),
                  getLandmarkConfidence(kneePoint),
                  getLandmarkConfidence(anklePoint)
                )

                if (
                  !hipPoint ||
                  !kneePoint ||
                  !anklePoint ||
                  visibility < MIN_VISIBILITY
                ) {
                  setKneeAngle(null)
                  setTrackingStatus('Leg temporarily out of view')
                  setMovementMessage(
                    'Tracking paused. Bring the same hip, knee and ankle back into view.'
                  )

                  // Reset to the starting phase so a lost extended leg
                  // cannot be mistaken for a completed repetition.
                  resetMovementPhaseAfterTrackingLoss()
                } else {
                  setTrackingStatus(
                    sessionStatusRef.current === 'exercising'
                      ? `${trackedLegLabel} tracking`
                      : 'Body detected'
                  )

                  const rawAngle = calculateAngle(
                    hipPoint,
                    kneePoint,
                    anklePoint
                  )

                  if (
                    !Number.isFinite(rawAngle) ||
                    rawAngle < 35 ||
                    rawAngle > 178
                  ) {
                    setKneeAngle(null)
                    setTrackingStatus('Unreliable angle — reposition')
                    resetMovementPhaseAfterTrackingLoss()
                  } else {
                    // Median smoothing reduces single-frame jumps.
                    angleHistoryRef.current = [
                      ...angleHistoryRef.current.slice(-4),
                      rawAngle,
                    ]

                    const angle = getMedian(angleHistoryRef.current)
                    setKneeAngle(angle)

                    if (
                      sessionStatusRef.current === 'exercising' &&
                      angleHistoryRef.current.length >= 3
                    ) {
                      const now = performance.now()

                      if (phaseRef.current === 'bent') {
                        if (angle > EXTENSION_THRESHOLD) {
                          extensionFramesRef.current += 1
                        } else {
                          extensionFramesRef.current = 0
                        }

                        if (
                          extensionFramesRef.current >=
                            REQUIRED_EXTENSION_FRAMES &&
                          now - lastRepTimeRef.current >
                            MIN_REP_INTERVAL_MS
                        ) {
                          phaseRef.current = 'extended'
                          peakAngleRef.current = angle
                          extensionFramesRef.current = 0
                          returnFramesRef.current = 0

                          setMovementMessage(
                            'Extension detected. Slowly bend your knee again.'
                          )
                        }
                      } else {
                        peakAngleRef.current = Math.max(
                          peakAngleRef.current,
                          angle
                        )

                        if (angle < RETURN_THRESHOLD) {
                          returnFramesRef.current += 1
                        } else {
                          returnFramesRef.current = 0
                        }

                        if (
                          returnFramesRef.current >= REQUIRED_RETURN_FRAMES &&
                          repAnglesRef.current.length < TARGET_REPS
                        ) {
                          phaseRef.current = 'bent'
                          lastRepTimeRef.current = now

                          const completedAngle = peakAngleRef.current
                          peakAngleRef.current = 0
                          returnFramesRef.current = 0

                          const nextCount =
                            repAnglesRef.current.length + 1

                          repAnglesRef.current = [
                            ...repAnglesRef.current,
                            completedAngle,
                          ]

                          setRepAngles([...repAnglesRef.current])
                          setRepetitions(nextCount)

                          setMovementMessage(
                            `Repetition ${nextCount} recorded. Best extension: ${completedAngle}°.`
                          )

                          if (nextCount >= TARGET_REPS) {
                            const currentSetAngles = [
                              ...repAnglesRef.current,
                            ]

                            const best = Math.max(...currentSetAngles)
                            const average = Math.round(
                              currentSetAngles.reduce(
                                (sum, value) => sum + value,
                                0
                              ) / currentSetAngles.length
                            )

                            const currentSet = setNumberRef.current

                            const report: SetReport = {
                              setNumber: currentSet,
                              repetitions: currentSetAngles.length,
                              angles: currentSetAngles,
                              bestAngle: best,
                              averageAngle: average,
                              targetRepetitions: TARGET_REPS,
                            }

                            setSetReports((previous) => [
                              ...previous.filter(
                                (item) => item.setNumber !== currentSet
                              ),
                              report,
                            ])

                            updateStatus('resting')

                            const nextRestPhase =
                              currentSet < TARGET_SETS
                                ? 'set'
                                : 'exercise'

                            setRestPhase(nextRestPhase)

                            setMovementMessage(
                              nextRestPhase === 'set'
                                ? 'Set complete. Your prescribed rest period has started.'
                                : 'Exercise complete. Your final recovery period has started.'
                            )

                            speak(
                              nextRestPhase === 'set'
                                ? 'Set complete. Your rest period is starting.'
                                : 'Exercise complete. Your recovery period is starting.'
                            )
                          }
                        }
                      }
                    }
                  }
                }
              }
            } else {
              latestLandmarksRef.current = null
              setTrackingStatus('No body detected')
              setKneeAngle(null)
              setMovementMessage('Move into view of the camera.')
              if (sessionStatusRef.current === 'exercising') {
                setTrackingStatus('Waiting for body landmarks')
                resetMovementPhaseAfterTrackingLoss()
              } else {
                resetTrackingCounters()
              }
            }
          } catch (err) {
            console.error('Pose detection error:', err)
            setTrackingStatus('Tracking paused')
          }

          animationFrame = requestAnimationFrame(detectPose)
        }

        detectPose()
      } catch (err) {
        console.error('MediaPipe error:', err)

        if (!cancelled) {
          setTrackingStatus('Tracking unavailable')
          setError(
            'Unable to load pose detection. Check your internet connection and try again.'
          )
        }
      }
    }

    initializeTracking()

    return () => {
      cancelled = true
      cancelAnimationFrame(animationFrame)

      landmarker?.close()
      landmarkerRef.current = null

      const context = canvasRef.current?.getContext('2d')

      if (context && canvasRef.current) {
        context.clearRect(
          0,
          0,
          canvasRef.current.width,
          canvasRef.current.height
        )
      }
    }
  }, [cameraOn])

  // Automatically handle the OT-configured rest timer.
  useEffect(() => {
    if (sessionStatus !== 'resting') return

    setRestRemaining(restDuration)

    const endTime = Date.now() + restDuration * 1000

    const interval = window.setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((endTime - Date.now()) / 1000)
      )

      setRestRemaining(remaining)

      if (remaining <= 0) {
        window.clearInterval(interval)

        if (restPhase === 'set' && setNumber < TARGET_SETS) {
          setSetNumber((previous) => previous + 1)
          setNumberRef.current = setNumber + 1

          setRepetitions(0)
          repAnglesRef.current = []
          setRepAngles([])

          phaseRef.current = 'bent'
          lastRepTimeRef.current = 0
          resetTrackingCounters()

          updateStatus('exercising')

          setMovementMessage(
            'Rest complete. Begin your next set when ready.'
          )

          speak(
            'Rest complete. Begin your next set when you are ready.'
          )
        } else {
          updateStatus('completed')

          setMovementMessage(
            'Seated knee extension completed. Your report is ready.'
          )

          speak(
            'Recovery period complete. Your session report is ready.'
          )

          saveAndSendReport()
        }
      }
    }, 250)

    return () => window.clearInterval(interval)
  }, [sessionStatus, restDuration, setNumber, restPhase])

  function saveAndSendReport(
    status: 'completed' | 'incomplete' = 'completed'
  ) {
    if (completionSentRef.current) return

    completionSentRef.current = true

    const sets = [...setReports]

    // Completed sets already contain their repetitions.
    // Add current repetitions only if they are not in a saved set.
    const currentSetAlreadySaved = sets.some(
      (item) => item.setNumber === setNumber
    )

    const allAngles = sets.flatMap((item) => item.angles)

    if (!currentSetAlreadySaved) {
      allAngles.push(...repAnglesRef.current)
    }

    const totalReps = allAngles.length

    const report: KneeSessionReport = {
      id: `knee-${Date.now()}`,
      patientName: 'Alex Morgan',
      exercise: 'Seated knee extension',
      completedAt: new Date().toISOString(),
      status,

      targetRepetitionsPerSet: TARGET_REPS,
      targetSets: TARGET_SETS,

      extensionThresholdDegrees: EXTENSION_THRESHOLD,
      returnThresholdDegrees: RETURN_THRESHOLD,
      restSeconds: restDuration,

      totalRepetitions: totalReps,

      bestExtensionAngle: allAngles.length
        ? Math.max(...allAngles)
        : null,

      averageExtensionAngle: allAngles.length
        ? Math.round(
            allAngles.reduce((sum, value) => sum + value, 0) /
              allAngles.length
          )
        : null,

      sets,
      repAngles: allAngles,

      dataQualityNote:
        'Angles are 2D webcam estimates and are not clinically validated. Camera position, occlusion, body orientation, and landmark quality can affect measurements.',

      aiAnalysisInput: {
        purpose:
          'Provide an OT-facing descriptive summary of this exercise session, not a diagnosis or treatment recommendation.',

        metrics: [
          'completed repetitions',
          'per-repetition peak knee angle',
          'per-set best angle',
          'per-set average angle',
          'session best and average angle',
          'number of completed sets',
          'data quality limitations',
        ],

        instruction:
          'Describe observed performance and data limitations. Do not infer pain, strength, diagnosis, or clinical range of motion.',
      },
    }

    try {
      const previous = JSON.parse(
        localStorage.getItem(REPORTS_KEY) || '[]'
      )

      localStorage.setItem(
        REPORTS_KEY,
        JSON.stringify([...previous, report])
      )
    } catch (err) {
      console.error('Unable to save session report:', err)
    }

    onComplete(report)
  }

  function startSession() {
    if (!cameraOn) return

    completionSentRef.current = false

    repAnglesRef.current = []
    setRepAngles([])
    setSetReports([])

    setRepetitions(0)
    setSetNumber(1)
    setNumberRef.current = 1

    // Do not require landmarks at the instant Start is pressed.
    // Detection will lock onto the best visible leg when it appears.
    trackedLegRef.current = null
    setTrackedLegLabel('Waiting for leg')
    latestLandmarksRef.current = null

    phaseRef.current = 'bent'
    lastRepTimeRef.current = 0
    resetTrackingCounters()

    updateStatus('exercising')

    setTrackingStatus('Waiting for hip, knee and ankle')
    setKneeAngle(null)
    setMovementMessage(
      'Session started. Sit side-on and bring your hip, knee and ankle into view.'
    )

    speak('Your seated knee extension session is starting.')
  }

  function pauseSession() {
    updateStatus('paused')
    resetTrackingCounters()

    setMovementMessage('Session paused.')
    speak('Session paused.')
  }

  function resumeSession() {
    updateStatus('exercising')

    phaseRef.current = 'bent'
    lastRepTimeRef.current = 0
    resetTrackingCounters()

    setMovementMessage(
      'Ready to continue. Begin with your knee bent.'
    )

    speak('You can continue when ready.')
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null

    setCameraOn(false)
    latestLandmarksRef.current = null
    trackedLegRef.current = null
    setTrackedLegLabel('Not selected')

    if (sessionStatusRef.current !== 'completed') {
      updateStatus('ready')
    }

    setTrackingStatus('Camera off')
    setKneeAngle(null)
    resetTrackingCounters()
  }

  function endSession() {
    if (
      sessionStatusRef.current === 'exercising' ||
      sessionStatusRef.current === 'resting' ||
      sessionStatusRef.current === 'paused'
    ) {
      saveAndSendReport('incomplete')
    }

    window.speechSynthesis?.cancel()

    stopCamera()
    onBack()
  }

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel()

      streamRef.current?.getTracks().forEach((track) => track.stop())

      landmarkerRef.current?.close()
    }
  }, [])

  const progress = (repetitions / TARGET_REPS) * 100

  const allRepAngles = [
    ...setReports.flatMap((item) => item.angles),
    ...repAngles,
  ]

  const bestAngle = allRepAngles.length
    ? Math.max(...allRepAngles)
    : null

  const averageAngle = allRepAngles.length
    ? Math.round(
        allRepAngles.reduce((sum, value) => sum + value, 0) /
          allRepAngles.length
      )
    : null

  return (
    <div className="dashboard">
      <header className="app-header">
        <div className="header-brand">
          <span className="mini-mark">k.</span>
          <span>kinetiq</span>
        </div>

        <button className="logout-button" onClick={endSession}>
          Exit session
        </button>
      </header>

      <main className="session-content">
        <button className="back-link" onClick={endSession}>
          ← Back to dashboard
        </button>

        <span className="eyebrow">KNEE REHABILITATION</span>

        <h1>Exercise session</h1>

        <p className="session-subtitle">
          Sit sideways to the camera with your hip, knee and ankle visible.
        </p>

        {/* CAMERA AND MOVEMENT ANALYSIS SIDE BY SIDE */}
        <div className="session-layout">
          <div className="camera-card">
            <div className="camera-heading">
              <div>
                <strong>Live movement tracking</strong>
                <p>Keep your hip, knee and ankle visible.</p>
              </div>

              <span
                className={
                  cameraOn
                    ? 'camera-status active'
                    : 'camera-status'
                }
              >
                {cameraOn ? 'Camera connected' : 'Camera off'}
              </span>
            </div>

            <div className="camera-preview">
              {cameraOn ? (
                <div className="pose-stage">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="camera-video"
                  />

                  <canvas
                    ref={canvasRef}
                    className="pose-canvas"
                  />
                </div>
              ) : (
                <div className="camera-placeholder">
                  <div className="camera-symbol">◎</div>
                  <strong>Your camera preview will appear here</strong>
                  <p>Enable your camera to begin body tracking.</p>
                </div>
              )}
            </div>

            <div className="tracking-indicator">
              <span className="tracking-dot" />
              <span>{trackingStatus}</span>
              {sessionStatus === 'exercising' && (
                <span> · {trackedLegLabel}</span>
              )}
            </div>

            {error && <p className="camera-error">{error}</p>}

            {!cameraOn ? (
              <button
                className="primary-action"
                onClick={startCamera}
              >
                Enable camera →
              </button>
            ) : (
              <button
                className="secondary-action"
                onClick={stopCamera}
              >
                Turn camera off
              </button>
            )}
          </div>

        <section className="session-analysis-panel session-side-panel">
          <div className="analysis-heading">
            <div>
              <span className="eyebrow">MOVEMENT ANALYSIS</span>
              <h2>Seated knee extension</h2>
            </div>

            <span
              className={`camera-status ${
                sessionStatus === 'exercising' ? 'active' : ''
              }`}
            >
              {sessionStatus === 'exercising'
                ? 'Tracking active'
                : sessionStatus === 'resting'
                  ? 'Rest period'
                  : sessionStatus === 'completed'
                    ? 'Complete'
                    : sessionStatus === 'paused'
                      ? 'Paused'
                      : 'Ready'}
            </span>
          </div>

          <div className="analysis-metrics">
            <div className="analysis-metric">
              <span>LIVE KNEE ANGLE</span>
              <strong>
                {kneeAngle !== null ? `${kneeAngle}°` : '--'}
              </strong>
            </div>

            <div className="analysis-metric">
              <span>REPETITIONS</span>
              <strong>{repetitions}/{TARGET_REPS}</strong>
            </div>

            <div className="analysis-metric">
              <span>SET</span>
              <strong>{setNumber}/{TARGET_SETS}</strong>
            </div>

            <div className="analysis-metric">
              <span>BEST EXTENSION</span>
              <strong>
                {bestAngle !== null ? `${bestAngle}°` : '--'}
              </strong>
            </div>

            <div className="analysis-metric">
              <span>AVERAGE EXTENSION</span>
              <strong>
                {averageAngle !== null ? `${averageAngle}°` : '--'}
              </strong>
            </div>
          </div>

          <p className="analysis-feedback">{movementMessage}</p>

          <div className="analysis-progress">
            <div style={{ width: `${progress}%` }} />
          </div>

          {sessionStatus === 'resting' && (
            <div className="rest-panel">
              <span className="eyebrow">
                {restPhase === 'set'
                  ? 'REST BETWEEN SETS'
                  : 'POST-EXERCISE RECOVERY'}
              </span>

              <strong>{restRemaining}s</strong>

              <p>
                {restPhase === 'set'
                  ? 'Your next set begins automatically when the timer ends.'
                  : 'Your session report will be finalized when recovery ends.'}
              </p>
            </div>
          )}

          {sessionStatus === 'completed' && (
            <p className="analysis-feedback">
              Session report saved for OT review.
            </p>
          )}

          <div className="analysis-controls">
            {sessionStatus === 'ready' && (
              <button
                className="primary-action"
                disabled={!cameraOn}
                onClick={startSession}
              >
                Start exercise session →
              </button>
            )}

            {sessionStatus === 'exercising' && (
              <button
                className="primary-action"
                onClick={pauseSession}
              >
                Pause session
              </button>
            )}

            {sessionStatus === 'paused' && (
              <button
                className="primary-action"
                onClick={resumeSession}
              >
                Resume session →
              </button>
            )}

            {sessionStatus === 'resting' && (
              <button
                className="primary-action"
                onClick={pauseSession}
              >
                Pause session
              </button>
            )}

            {sessionStatus === 'completed' && (
              <button
                className="primary-action"
                onClick={endSession}
              >
                Return to dashboard →
              </button>
            )}
          </div>
        </section>
        </div>

          <aside className="exercise-guide">
            <span className="eyebrow">YOUR MOVEMENT GUIDE</span>

            <h2>How to perform the movement</h2>

            <p className="guide-intro">
              Sit tall with your feet on the floor. Slowly straighten
              one knee, then lower your foot with control.
            </p>

            <div
              className="movement-diagram"
              role="img"
              aria-label="Seated knee bend then straighten illustration"
            >
              <div className="diagram-step">
                <svg viewBox="0 0 150 145" aria-hidden="true">
                  <path d="M18 126 H132 M43 70 V111 H65 M39 111 V130 M65 111 V130" />
                  <circle cx="58" cy="19" r="10" />
                  <path d="M58 30 L55 64 L76 76 M55 64 L43 70 M76 76 L101 76 L101 96 L84 115 L104 115 M58 36 L39 53" />
                </svg>

                <strong>1. Bend</strong>
                <span>Start with your knee bent.</span>
              </div>

              <div className="diagram-arrow">→</div>

              <div className="diagram-step">
                <svg viewBox="0 0 150 145" aria-hidden="true">
                  <path d="M18 126 H132 M43 70 V111 H65 M39 111 V130 M65 111 V130" />
                  <circle cx="58" cy="19" r="10" />
                  <path d="M58 30 L55 64 L76 76 M55 64 L43 70 M76 76 L101 76 L124 76 L130 83 M58 36 L39 53" />
                </svg>

                <strong>2. Straighten</strong>
                <span>Extend past 110°, then return.</span>
              </div>
            </div>

            <div className="guide-tip">
              <strong>Remember</strong>
              <p>
                Keep your thigh still, move slowly, and avoid forcing
                your knee straight.
              </p>
            </div>

            <div className="camera-position-tip">
              <span className="eyebrow">CAMERA POSITION</span>
              <p>
                Place the camera at knee height, a few feet away.
                Sit side-on so your hip, knee, and ankle are visible.
              </p>
            </div>

            <div className="guide-tip">
              <strong>OT-prescribed rest</strong>
              <p>
                {restDuration} seconds between sets and after the exercise.
              </p>
            </div>
          </aside>

        <p className="demo-note">
          Experimental movement tracking. Knee angles are estimated
          from a 2D webcam view and are not clinically validated.
          Camera position and landmark quality affect measurements.
          Stop if you experience pain and follow your therapist's
          instructions.
        </p>
      </main>
    </div>
  )
}

export default KneeSession
