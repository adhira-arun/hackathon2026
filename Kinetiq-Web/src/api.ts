export type AiSummary = {
  summary: string
  strengths: string[]
  concerns: string[]
  flagsForOT: string[]
  model: string
  generatedAt: string
}

export type OtReview = {
  notes: string
  status: 'pending' | 'reviewed' | 'needs_follow_up'
  reviewedAt: string
}

// Any session report (knee, neck, ...) only needs these fields to be reviewable.
export type StoredReport = {
  id: string
  aiSummary?: AiSummary
  otReview?: OtReview
}

const API_BASE =
  import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3001`

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })

  const body = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(body.error || `Request failed (${response.status})`)
  }

  return body as T
}

export function sendReport(report: StoredReport) {
  return request<StoredReport>('/api/reports', {
    method: 'POST',
    body: JSON.stringify(report),
  })
}

export function fetchReports<T extends StoredReport = StoredReport>() {
  return request<T[]>('/api/reports')
}

export function generateSummary(id: string) {
  return request<StoredReport>(`/api/reports/${id}/summary`, {
    method: 'POST',
  })
}

export function saveReview(
  id: string,
  review: { notes: string; status: OtReview['status'] }
) {
  return request<StoredReport>(`/api/reports/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(review),
  })
}