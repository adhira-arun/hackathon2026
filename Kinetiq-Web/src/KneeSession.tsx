
import { useEffect, useRef, useState } from 'react'
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

import './App.css'

type KneeSessionProps = {
  onBack: () => void
}

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
  [11, 12],
  [11, 13], [13, 15],
  [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31],
  [24, 26], [26, 28], [28, 30], [30, 32],
  [27, 31], [28, 32],
]

function KneeSession({ onBack }: KneeSessionProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const landmarkerRef = useRef<PoseLandmarker | null>(null)

  const [cameraOn, setCameraOn] = useState(false)
  const [sessionStarted, setSessionStarted] = useState(false)
  const [trackingStatus, setTrackingStatus] = useState('Waiting for camera')
  const [error, setError] = useState('')

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

  // Attach the camera stream to the video element.
  useEffect(() => {
    if (cameraOn && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current

      videoRef.current.play().catch(() => {
        setError('Unable to start the camera preview.')
      })
    }
  }, [cameraOn])

  // Load MediaPipe and begin live pose detection.
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
              const landmarks = results.landmarks[0]

              setTrackingStatus('Body detected')

              // Draw skeleton connections.
              context.strokeStyle = '#D8C4A8'
              context.lineWidth = Math.max(3, width / 250)
              context.lineCap = 'round'

              CONNECTIONS.forEach(([start, end]) => {
                const first = landmarks[start]
                const second = landmarks[end]

                if (
                  first.visibility !== undefined &&
                  second.visibility !== undefined &&
                  (first.visibility < 0.5 || second.visibility < 0.5)
                ) {
                  return
                }

                context.beginPath()
                context.moveTo(first.x * width, first.y * height)
                context.lineTo(second.x * width, second.y * height)
                context.stroke()
              })

              // Draw body landmarks.
              landmarks.forEach((point) => {
                if (point.visibility !== undefined && point.visibility < 0.5) {
                  return
                }

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
            } else {
              setTrackingStatus('No body detected')
            }
          } catch {
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

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null

    setCameraOn(false)
    setSessionStarted(false)
    setTrackingStatus('Camera off')
  }

  function endSession() {
    stopCamera()
    onBack()
  }

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      landmarkerRef.current?.close()
    }
  }, [])

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
          Position yourself so your body is visible to the camera.
        </p>

        <div className="camera-card">
          <div className="camera-heading">
            <div>
              <strong>Live movement tracking</strong>
              <p>Keep your full body visible during tracking.</p>
            </div>

            <span className={cameraOn ? 'camera-status active' : 'camera-status'}>
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
          </div>

          {error && <p className="camera-error">{error}</p>}

          <div className="camera-controls">
            {!cameraOn ? (
              <button className="primary-action" onClick={startCamera}>
                Enable camera →
              </button>
            ) : (
              <button
                className="primary-action"
                onClick={() => setSessionStarted(!sessionStarted)}
              >
                {sessionStarted ? 'Pause session' : 'Start session →'}
              </button>
            )}

            {cameraOn && (
              <button className="secondary-action" onClick={stopCamera}>
                Turn camera off
              </button>
            )}
          </div>
        </div>

        <section className="session-exercises">
          <span className="eyebrow">YOUR ASSIGNED PROGRAM</span>
          <h2>Today's exercises</h2>

          <div className="session-exercise">
            <div>
              <strong>Standing Knee Raises</strong>
              <p>2 sets × 10 repetitions</p>
            </div>
          </div>

          <div className="session-exercise">
            <div>
              <strong>Clamshells</strong>
              <p>2 sets × 10 repetitions · Green band</p>
            </div>
          </div>

          <div className="session-exercise">
            <div>
              <strong>Seated Knee Extensions</strong>
              <p>2 sets × 10 repetitions</p>
            </div>
          </div>
        </section>

        <p className="demo-note">
          Experimental pose tracking demonstration. Landmark detection is
          not a clinically validated assessment. Follow your therapist's
          instructions.
        </p>
      </main>
    </div>
  )
}

export default KneeSession
