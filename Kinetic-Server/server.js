import express from 'express'
import cors from 'cors'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const DATA_FILE = path.join(DATA_DIR, 'reports.json')

const PORT = Number(process.env.PORT) || 3001
const API_KEY = process.env.GEMINI_API_KEY
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash'

const REVIEW_STATUSES = ['pending', 'reviewed', 'needs_follow_up']

const SYSTEM_PROMPT = `You assist an occupational therapist (OT) who is reviewing a patient's home exercise session.
You are given numeric session data measured by webcam pose tracking.
Rules:
- Describe only what the numbers show. Quote the numbers you rely on.
- Do NOT diagnose, and do NOT infer pain, strength, or clinical range of motion.
- Do NOT recommend treatment or changes to the program. Raise questions for the OT instead.
- Angles are 2D webcam estimates and may be affected by camera position and occlusion.
- For neck exercises, values are 2D webcam movement proxies in degrees, not clinical cervical range of motion.
- Be brief and neutral. Use plain language.
Return JSON only, with exactly these keys:
{ "summary": string (2-4 sentences), "strengths": string[], "concerns": string[], "flagsForOT": string[] }
Use empty arrays when there is nothing to report.`

const app = express()
app.use(cors()) // fine for a demo; restrict origins before any real deployment
app.use(express.json({ limit: '1mb' }))

/* ---------- storage (JSON file, serialized writes) ---------- */

let queue = Promise.resolve()

function withLock(task) {
  const run = queue.then(task)
  queue = run.catch(() => {})
  return run
}

async function readAll() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, 'utf8'))
  } catch {
    return []
  }
}

async function writeAll(reports) {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(DATA_FILE, JSON.stringify(reports, null, 2))
}

function updateReport(id, mutate) {
  return withLock(async () => {
    const reports = await readAll()
    const index = reports.findIndex((r) => r.id === id)
    if (index === -1) return null
    reports[index] = mutate(reports[index])
    await writeAll(reports)
    return reports[index]
  })
}

/* ---------- helpers for the AI prompt ---------- */

const round1 = (n) => Math.round(n * 10) / 10

function stats(values) {
  if (!values.length) return null
  const n = values.length
  const mean = values.reduce((a, b) => a + b, 0) / n
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n
  return {
    count: n,
    min: Math.min(...values),
    max: Math.max(...values),
    mean: round1(mean),
    stdDev: round1(Math.sqrt(variance)),
  }
}

function mean(values) {
  return values.length
    ? round1(values.reduce((a, b) => a + b, 0) / values.length)
    : null
}

// Only numbers go to the model. The patient name is deliberately left out.
function buildKneeInput(report) {
  const sets = Array.isArray(report.sets) ? report.sets : []
  const all = Array.isArray(report.repAngles) ? report.repAngles : []
  const targetReps =
    (report.targetSets ?? 0) * (report.targetRepetitionsPerSet ?? 0)
  const half = Math.floor(all.length / 2)

  return {
    exercise: report.exercise,
    sessionStatus: report.status,
    prescription: {
      sets: report.targetSets,
      repsPerSet: report.targetRepetitionsPerSet,
      restSeconds: report.restSeconds,
      extensionThresholdDegrees: report.extensionThresholdDegrees,
      returnThresholdDegrees: report.returnThresholdDegrees,
    },
    completion: {
      repsCompleted: report.totalRepetitions,
      repsTarget: targetReps,
      percent: targetReps
        ? Math.round((100 * report.totalRepetitions) / targetReps)
        : null,
    },
    peakAngleStatsAllReps: stats(all),
    firstHalfMeanAngle: half >= 1 ? mean(all.slice(0, half)) : null,
    secondHalfMeanAngle: half >= 1 ? mean(all.slice(half)) : null,
    sets: sets.map((s) => ({
      setNumber: s.setNumber,
      repsCompleted: s.repetitions,
      repsTarget: s.targetRepetitions,
      bestAngle: s.bestAngle,
      averageAngle: s.averageAngle,
      peakAnglePerRep: s.angles,
    })),
    dataQualityNote: report.dataQualityNote,
  }
}

function buildNeckInput(report) {
  const metrics = report.movementMetrics ?? {}
  const movement = {}

  for (const [name, value] of Object.entries(metrics)) {
    if (Array.isArray(value) && value.every((v) => typeof v === 'number')) {
      const valid = value.filter((v) => Number.isFinite(v) && v >= 0 && v <= 90)
      movement[name] = { perRepValues: value, validValueStats: stats(valid) }
    }
  }

  const targetReps =
    (report.targetSets ?? 0) * (report.targetRepetitionsPerSet ?? 0)

  return {
    exercise: report.exercise,
    sessionStatus: report.status,
    prescription: {
      sets: report.targetSets,
      repsPerSet: report.targetRepetitionsPerSet,
      restSeconds: report.restSeconds,
    },
    completion: {
      repsCompleted: report.totalRepetitions,
      repsTarget: targetReps,
      percent: targetReps
        ? Math.round((100 * report.totalRepetitions) / targetReps)
        : null,
    },
    movementMeasures2DProxyDegrees: movement,
    sets: (report.sets ?? []).map((s) => ({
      setNumber: s.setNumber,
      repsCompleted: s.repetitions,
      repsTarget: s.targetRepetitions,
    })),
    dataQualityNote: report.dataQualityNote,
  }
}

function buildModelInput(report) {
  return report.movementMetrics ? buildNeckInput(report) : buildKneeInput(report)
}


function toStringArray(value) {
  return Array.isArray(value)
    ? value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim())
    : []
}

async function callGemini(input) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`
   console.log(`Calling Gemini (${MODEL})...`)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          role: 'user',
          parts: [
            { text: `Session data (JSON):\n${JSON.stringify(input, null, 2)}` },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error(`Gemini error ${response.status}:`, detail.slice(0, 500))
    const err = new Error(`Gemini returned ${response.status}`)
    err.status = response.status
    throw err
  }

  const data = await response.json()
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? '')
    .join('')

  if (!text) throw new Error('The AI returned an empty response.')

  const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    strengths: toStringArray(parsed.strengths),
    concerns: toStringArray(parsed.concerns),
    flagsForOT: toStringArray(parsed.flagsForOT),
  }
}

function friendlyAiError(err) {
  if (err.status === 429) {
    return 'The free AI quota is used up for now. Wait a minute and try again.'
  }
  if (err.status === 400 || err.status === 403 || err.status === 404) {
    return 'Gemini rejected the request. Check GEMINI_API_KEY and GEMINI_MODEL in .env.'
  }
  if (err instanceof SyntaxError) {
    return 'The AI reply could not be read. Please try again.'
  }
  if (err.name === 'TimeoutError') {
    return 'The AI took too long to respond. Please try again.'
  }
  return 'Could not generate the summary. Please try again.'
}

/* ---------- routes ---------- */

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, aiConfigured: Boolean(API_KEY), model: MODEL })
})

app.get('/api/reports', async (_req, res) => {
  res.json(await readAll())
})

// Create or update a report. Keeps any AI summary / OT review already stored.
app.post('/api/reports', async (req, res) => {
  const incoming = req.body

  if (
    !incoming ||
    typeof incoming.id !== 'string' ||
    !Array.isArray(incoming.sets)
  ) {
    return res.status(400).json({ error: 'Invalid report.' })
  }

  const saved = await withLock(async () => {
    const reports = await readAll()
    const index = reports.findIndex((r) => r.id === incoming.id)
    const existing = index === -1 ? null : reports[index]

    const merged = {
      ...existing,
      ...incoming,
      aiSummary: incoming.aiSummary ?? existing?.aiSummary,
      otReview: incoming.otReview ?? existing?.otReview,
    }

    if (index === -1) reports.push(merged)
    else reports[index] = merged

    await writeAll(reports)
    return merged
  })

  res.json(saved)
})

app.post('/api/reports/:id/summary', async (req, res) => {
  if (!API_KEY) {
    return res
      .status(503)
      .json({ error: 'AI is not configured. Add GEMINI_API_KEY to .env.' })
  }

  const reports = await readAll()
  const report = reports.find((r) => r.id === req.params.id)
  if (!report) return res.status(404).json({ error: 'Report not found.' })

  try {
    const result = await callGemini(buildModelInput(report))

    const updated = await updateReport(report.id, (r) => ({
      ...r,
      aiSummary: {
        ...result,
        model: MODEL,
        generatedAt: new Date().toISOString(),
      },
    }))

    res.json(updated)
  } catch (err) {
    console.error('Summary generation failed:', err)
    res.status(err.status === 429 ? 429 : 502).json({ error: friendlyAiError(err) })
  }
})

app.patch('/api/reports/:id', async (req, res) => {
  const { notes, status } = req.body ?? {}

  if (typeof notes !== 'string' || notes.length > 5000) {
    return res.status(400).json({ error: 'Notes must be text under 5000 characters.' })
  }
  if (!REVIEW_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid review status.' })
  }

  const updated = await updateReport(req.params.id, (r) => ({
    ...r,
    otReview: { notes, status, reviewedAt: new Date().toISOString() },
  }))

  if (!updated) return res.status(404).json({ error: 'Report not found.' })
  res.json(updated)
})

app.listen(PORT, () => {
  console.log(`Kinetiq server running on http://localhost:${PORT}`)
  console.log(
    API_KEY
      ? `Gemini model: ${MODEL}`
      : 'WARNING: GEMINI_API_KEY is not set. AI summaries are disabled.'
  )
})