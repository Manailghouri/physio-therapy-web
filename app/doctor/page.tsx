"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RecordExercise } from "@/components/record-exercise"
import { supabase } from "@/utils/supabase/client"
import { useRouter } from "next/navigation"
import Link from "next/link"

interface LinkedPatient {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
}

export default function DoctorPage() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [doctorCode, setDoctorCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [patients, setPatients] = useState<LinkedPatient[]>([])
  const [patientsLoading, setPatientsLoading] = useState(true)
  const [assignPatient, setAssignPatient] = useState<LinkedPatient | null>(null)

  useEffect(() => {
    async function loadDoctor() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.replace("/login")
        return
      }
      setEmail(session.user.email ?? null)

    // Fetch doctor code
    const { data: doctor } = await supabase
      .from("doctors")
      .select("doctor_code")
      .eq("id", session.user.id)
      .single()

      if (error) {
        console.error("[doctor] Failed to fetch doctor_code:", error.message, error.code)
      }

      setDoctorCode(data?.doctor_code ?? null)

      const { data: patientRows, error: patientsErr } = await supabase
        .from("patients")
        .select("id")
        .eq("doctor_id", session.user.id)

      console.log(patientRows)

      if (patientsErr) {
        console.error("[doctor] Failed to fetch patients:", patientsErr.message)
        setPatientsLoading(false)
        return
      }

      if (patientRows && patientRows.length > 0) {
        const ids = patientRows.map((p) => p.id)
        const { data: userRows, error: usersErr } = await supabase
          .from("users")
          .select("id, email, first_name, last_name")
          .in("id", ids)

        if (usersErr) {
          console.error("[doctor] Failed to fetch patient users:", usersErr.message)
        }

        setPatients(
          (userRows ?? []).map((u) => ({
            id: u.id,
            email: u.email ?? "",
            firstName: u.first_name ?? null,
            lastName: u.last_name ?? null,
          }))
        )
      }

      setPatientsLoading(false)
    }
    loadDoctor()
  }, [router])

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  const handleCopy = async () => {
    if (!doctorCode) return
    await navigator.clipboard.writeText(doctorCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/login")
  }

  // ── Stats ─────────────────────────────────────────────────────

  const totalPatients = patients.length
  const totalAssignments = patients.reduce((s, p) => s + p.assignments.length, 0)
  const allSessions = patients.flatMap(p => p.sessions)
  const totalSessions = allSessions.length
  const avgScore = totalSessions > 0
    ? Math.round(allSessions.reduce((s, x) => s + x.similarity_score, 0) / totalSessions)
    : 0

  // ── Render ────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  // If assigning exercise, show that view
  if (assigningFor) {
    const patient = patients.find(p => p.info.id === assigningFor)
    return (
      <AssignExerciseView
        patientName={getPatientName(patient?.info)}
        patientId={assigningFor}
        accessToken={accessToken!}
        onBack={() => setAssigningFor(null)}
        onAssigned={() => {
          setAssigningFor(null)
          loadDashboard()
        }}
      />
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold">Dashboard</h1>
            {doctorCode && (
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted text-xs font-mono font-medium hover:bg-muted/80 transition-colors"
              >
                <span className="text-muted-foreground">Code:</span>
                <span className="font-bold tracking-wider">{doctorCode}</span>
                {copied
                  ? <Check className="w-3 h-3 text-green-500" />
                  : <Copy className="w-3 h-3 text-muted-foreground" />
                }
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:inline">{email}</span>
            <Button variant="outline" size="sm" onClick={handleSignOut}>Sign Out</Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            label="Patients"
            value={totalPatients}
            icon={<Users className="w-4 h-4" />}
            color="text-blue-600 dark:text-blue-400"
            bg="bg-blue-50 dark:bg-blue-950/30"
          />
          <StatCard
            label="Exercises Assigned"
            value={totalAssignments}
            icon={<Dumbbell className="w-4 h-4" />}
            color="text-purple-600 dark:text-purple-400"
            bg="bg-purple-50 dark:bg-purple-950/30"
          />
          <StatCard
            label="Sessions Completed"
            value={totalSessions}
            icon={<Activity className="w-4 h-4" />}
            color="text-green-600 dark:text-green-400"
            bg="bg-green-50 dark:bg-green-950/30"
          />
          <StatCard
            label="Avg Similarity"
            value={totalSessions > 0 ? `${avgScore}%` : "—"}
            icon={<TrendingUp className="w-4 h-4" />}
            color="text-amber-600 dark:text-amber-400"
            bg="bg-amber-50 dark:bg-amber-950/30"
          />
        </div>

        {/* Patients Section */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Your Patients</h2>
            {doctorCode && (
              <p className="text-xs text-muted-foreground">
                Share code <span className="font-mono font-bold">{doctorCode}</span> to link new patients
              </p>
            )}
          </div>

          {patients.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground mb-1">No patients linked yet</p>
                <p className="text-sm text-muted-foreground">
                  Share your code <span className="font-mono font-bold">{doctorCode}</span> with patients to get started.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {patients.map(patient => (
                <PatientCard
                  key={patient.info.id}
                  patient={patient}
                  expanded={expandedPatient === patient.info.id}
                  expandedExercise={expandedExercise}
                  onToggle={() =>
                    setExpandedPatient(prev =>
                      prev === patient.info.id ? null : patient.info.id
                    )
                  }
                  onToggleExercise={(id) =>
                    setExpandedExercise(prev => prev === id ? null : id)
                  }
                  onAssignExercise={() => setAssigningFor(patient.info.id)}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

// ── Helper ──────────────────────────────────────────────────────

function getPatientName(info?: PatientInfo): string {
  if (!info) return "Unknown"
  const name = [info.first_name, info.last_name].filter(Boolean).join(" ")
  return name || info.email
}

// ── StatCard ────────────────────────────────────────────────────

function StatCard({
  label, value, icon, color, bg,
}: {
  label: string
  value: number | string
  icon: React.ReactNode
  color: string
  bg: string
}) {
  return (
    <Card className="py-4">
      <CardContent className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${bg}`}>
          <span className={color}>{icon}</span>
        </div>
        <div>
          <p className="text-2xl font-bold leading-none">{value}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}

// ── PatientCard ─────────────────────────────────────────────────

function PatientCard({
  patient,
  expanded,
  expandedExercise,
  onToggle,
  onToggleExercise,
  onAssignExercise,
}: {
  patient: PatientData
  expanded: boolean
  expandedExercise: string | null
  onToggle: () => void
  onToggleExercise: (id: string) => void
  onAssignExercise: () => void
}) {
  const { info, assignments, sessions } = patient
  const name = getPatientName(info)
  const totalSessions = sessions.length
  const avgScore = totalSessions > 0
    ? Math.round(sessions.reduce((s, x) => s + x.similarity_score, 0) / totalSessions)
    : null
  const lastSession = sessions[0]

  return (
    <Card className="overflow-hidden">
      {/* Patient Header — always visible */}
      <button
        onClick={onToggle}
        className="w-full text-left px-6 py-4 flex items-center gap-4 hover:bg-muted/50 transition-colors"
      >
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <User className="w-5 h-5 text-primary" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{name}</p>
          <p className="text-xs text-muted-foreground truncate">{info.email}</p>
        </div>

        {/* Quick Stats */}
        <div className="hidden sm:flex items-center gap-4 text-sm">
          <div className="text-center">
            <p className="font-semibold">{assignments.length}</p>
            <p className="text-xs text-muted-foreground">Exercises</p>
          </div>
          <div className="text-center">
            <p className="font-semibold">{totalSessions}</p>
            <p className="text-xs text-muted-foreground">Sessions</p>
          </div>
          {avgScore !== null && (
            <div className="text-center">
              <p className={`font-semibold ${getSimilarityColor(avgScore)}`}>{avgScore}%</p>
              <p className="text-xs text-muted-foreground">Avg Score</p>
            </div>
          )}
          {lastSession && (
            <div className="text-center">
              <p className="font-semibold text-xs">
                {formatDistanceToNow(new Date(lastSession.completed_at), { addSuffix: true })}
              </p>
              <p className="text-xs text-muted-foreground">Last Active</p>
            </div>
          )}
        </div>

        {/* Expand arrow */}
        {expanded
          ? <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0" />
          : <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
        }
      </button>

      {/* Expanded Detail */}
      {expanded && (
        <div className="border-t px-6 py-4 space-y-4 bg-muted/30">
          {/* Mobile stats */}
          <div className="flex sm:hidden gap-3 flex-wrap">
            <MiniStat label="Exercises" value={assignments.length} />
            <MiniStat label="Sessions" value={totalSessions} />
            {avgScore !== null && <MiniStat label="Avg Score" value={`${avgScore}%`} />}
          </div>

          {/* Assigned Exercises */}
          {assignments.length === 0 ? (
            <div className="text-center py-6">
              <Dumbbell className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground mb-3">
                No exercises assigned yet
              </p>
              <Button size="sm" onClick={onAssignExercise}>
                <Plus className="w-4 h-4 mr-1" /> Assign Exercise
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Assigned Exercises
                </h3>
                <Button variant="outline" size="sm" onClick={onAssignExercise}>
                  <Plus className="w-3 h-3 mr-1" /> Assign
                </Button>
              </div>
              <div className="space-y-2">
                {assignments.map(assignment => {
                  const exerciseSessions = sessions
                    .filter(s => s.assignment_id === assignment.id)
                    .sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime())
                  const isExpanded = expandedExercise === assignment.id
                  return (
                    <ExerciseCard
                      key={assignment.id}
                      assignment={assignment}
                      sessions={exerciseSessions}
                      expanded={isExpanded}
                      onToggle={() => onToggleExercise(assignment.id)}
                    />
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  )
}

// ── MiniStat ────────────────────────────────────────────────────

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-background rounded-md border px-3 py-1.5 text-center">
      <p className="font-semibold text-sm">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  )
}

// ── ExerciseCard ────────────────────────────────────────────────

function ExerciseCard({
  assignment,
  sessions,
  expanded,
  onToggle,
}: {
  assignment: ExerciseAssignment
  sessions: ExerciseSession[]
  expanded: boolean
  onToggle: () => void
}) {
  const config = getExerciseConfig(assignment.exercise_type)
  const latestSession = sessions[0]
  const sessionCount = sessions.length
  const avgScore = sessionCount > 0
    ? Math.round(sessions.reduce((s, x) => s + x.similarity_score, 0) / sessionCount)
    : null

  // Trend: compare last session to average of previous sessions
  let trend: "up" | "down" | "stable" | null = null
  if (sessions.length >= 2) {
    const recent = sessions[0].similarity_score
    const prevAvg = sessions.slice(1).reduce((s, x) => s + x.similarity_score, 0) / (sessions.length - 1)
    if (recent > prevAvg + 3) trend = "up"
    else if (recent < prevAvg - 3) trend = "down"
    else trend = "stable"
  }

  return (
    <div className="bg-background rounded-lg border overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/50 transition-colors"
      >
        {/* Exercise icon */}
        <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Dumbbell className="w-4 h-4 text-primary" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{assignment.name}</p>
          <p className="text-xs text-muted-foreground">
            {config?.name ?? assignment.exercise_type}
            {assignment.created_at && (
              <> &middot; Assigned {format(new Date(assignment.created_at), "MMM d")}</>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {sessionCount > 0 && (
            <div className="text-right">
              <div className="flex items-center gap-1">
                {avgScore !== null && (
                  <span className={`text-sm font-semibold ${getSimilarityColor(avgScore)}`}>
                    {avgScore}%
                  </span>
                )}
                {trend === "up" && <TrendingUp className="w-3 h-3 text-green-500" />}
                {trend === "down" && <TrendingUp className="w-3 h-3 text-red-500 rotate-180" />}
              </div>
              <p className="text-[10px] text-muted-foreground">{sessionCount} session{sessionCount !== 1 ? "s" : ""}</p>
            </div>
          )}
          {sessionCount === 0 && (
            <span className="text-xs text-muted-foreground">No sessions yet</span>
          )}
          {expanded
            ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
            : <ChevronRight className="w-4 h-4 text-muted-foreground" />
          }
        </div>
      </button>

      {expanded && sessions.length > 0 && (
        <div className="border-t px-4 py-3 space-y-3">
          {/* Progress bar visual */}
          {sessions.length >= 2 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Progress over sessions</p>
              <div className="flex items-end gap-1 h-12">
                {sessions.slice().reverse().map((s, i) => (
                  <div
                    key={s.id}
                    className="flex-1 rounded-t-sm transition-all"
                    style={{
                      height: `${Math.max(s.similarity_score, 8)}%`,
                      backgroundColor: s.similarity_score >= 80
                        ? "var(--color-chart-2)"
                        : s.similarity_score >= 60
                          ? "var(--color-chart-5)"
                          : "var(--color-destructive)",
                      opacity: 0.5 + (i / sessions.length) * 0.5,
                    }}
                    title={`${s.similarity_score}% — ${format(new Date(s.completed_at), "MMM d")}`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Session list */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Session History</p>
            {sessions.map(session => (
              <SessionRow key={session.id} session={session} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── SessionRow ──────────────────────────────────────────────────

function SessionRow({ session }: { session: ExerciseSession }) {
  const [showDetails, setShowDetails] = useState(false)

  return (
    <div className="bg-muted/50 rounded-md">
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="w-full text-left px-3 py-2 flex items-center gap-3 text-sm hover:bg-muted transition-colors rounded-md"
      >
        <Calendar className="w-3 h-3 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground w-24 shrink-0">
          {format(new Date(session.completed_at), "MMM d, h:mm a")}
        </span>
        <div className="flex-1 flex items-center gap-3">
          {/* Similarity */}
          <div className="flex items-center gap-1.5">
            <div className="w-16 bg-muted rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full rounded-full ${getSimilarityBg(session.similarity_score)}`}
                style={{ width: `${session.similarity_score}%` }}
              />
            </div>
            <span className={`text-xs font-semibold min-w-[2rem] ${getSimilarityColor(session.similarity_score)}`}>
              {session.similarity_score}%
            </span>
          </div>
          {/* Reps */}
          <span className="text-xs text-muted-foreground">
            <Target className="w-3 h-3 inline mr-0.5" />
            {session.reps_completed}/{session.reps_expected} reps
          </span>
        </div>
        {showDetails
          ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
          : <ChevronRight className="w-3 h-3 text-muted-foreground" />
        }
      </button>

      {showDetails && (
        <div className="px-3 pb-3 space-y-2">
          {/* State Matches */}
          {session.state_matches && Object.keys(session.state_matches).length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground mb-1">State Accuracy</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(session.state_matches).map(([state, score]) => (
                  <span
                    key={state}
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      score >= 80
                        ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                        : score >= 60
                          ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400"
                          : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                    }`}
                  >
                    {state}: {Math.round(score)}%
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Angle Deviations */}
          {session.angle_deviations && Object.keys(session.angle_deviations).length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground mb-1">Angle Deviations</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(session.angle_deviations).map(([angle, deviation]) => (
                  <span
                    key={angle}
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      deviation < 10
                        ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                        : deviation < 20
                          ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400"
                          : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                    }`}
                  >
                    {formatAngleName(angle)}: {"\u00B1"}{Math.round(deviation)}{"\u00B0"}
                  </span>
                ))}
              </div>
            </div>
          )}

          {session.duration_seconds > 0 && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Duration: {Math.round(session.duration_seconds)}s
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── AssignExerciseView ──────────────────────────────────────────

function AssignExerciseView({
  patientName,
  patientId,
  accessToken,
  onBack,
  onAssigned,
}: {
  patientName: string
  patientId: string
  accessToken: string
  onBack: () => void
  onAssigned: () => void
}) {
  const [exerciseType, setExerciseType] = useState(EXERCISE_CONFIGS[0].id)
  const [exerciseName, setExerciseName] = useState("")
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null)
  const [step, setStep] = useState<"form" | "analyzing" | "saving" | "done">("form")
  const [error, setError] = useState<string | null>(null)
  const [analysisProgress, setAnalysisProgress] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const config = getExerciseConfig(exerciseType)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type.startsWith("video/")) {
      setVideoFile(file)
      setVideoPreviewUrl(URL.createObjectURL(file))
      setError(null)
    } else {
      setError("Please upload a valid video file")
    }
  }

  const handleAssign = async () => {
    if (!videoFile) return

    setError(null)
    setStep("analyzing")
    setAnalysisProgress("Analyzing video with MediaPipe...")

    try {
      // 1. Analyze the video
      const exerciseConfig = getExerciseConfig(exerciseType)
      const anglesOfInterest = exerciseConfig?.anglesOfInterest
      const name = exerciseName.trim() || exerciseConfig?.name || "Exercise"

      const result = await analyzeVideoForPose(
        videoFile,
        anglesOfInterest,
        { name, type: exerciseType }
      )

      setAnalysisProgress("Uploading video to storage...")

      // 2. Upload video to Supabase Storage
      const id = Date.now().toString()
      const fileName = `${id}_${name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.webm`
      const filePath = `${exerciseType}/${fileName}`

      const { error: uploadErr } = await supabase.storage
        .from("reference-videos")
        .upload(filePath, videoFile, {
          contentType: videoFile.type || "video/webm",
          cacheControl: "3600",
          upsert: false,
        })

      if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)

      const { data: urlData } = supabase.storage
        .from("reference-videos")
        .getPublicUrl(filePath)

      if (!urlData?.publicUrl) throw new Error("Failed to get video URL")

      setStep("saving")
      setAnalysisProgress("Saving exercise assignment...")

      // 3. Save assignment via API
      const res = await fetch("/api/doctor/assign-exercise", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          patient_id: patientId,
          name,
          exercise_type: exerciseType,
          video_url: urlData.publicUrl,
          template: result.learnedTemplate || null,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to assign exercise")

      setStep("done")
      setTimeout(onAssigned, 1200)
    } catch (err) {
      console.error("Error assigning exercise:", err)
      setError(err instanceof Error ? err.message : "An unexpected error occurred")
      setStep("form")
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
        <div className="flex items-center gap-3 px-6 py-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-lg font-semibold">Assign Exercise</h1>
            <p className="text-xs text-muted-foreground">For {patientName}</p>
          </div>
        </div>
      </div>
      <div className="p-8">
        {doctorCode && (
          <div className="space-y-6">
            <div className="rounded-lg border p-6 max-w-sm">
              <p className="text-sm text-muted-foreground mb-1">Your doctor code</p>
              <p className="text-3xl font-mono font-bold tracking-widest">{doctorCode}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={handleCopy}
              >
                {copied ? "Copied!" : "Copy Code"}
              </Button>
              <p className="text-sm text-muted-foreground mt-3">
                Share this code with your patients so they can link to you.
              </p>
            </div>

            <Link href="/doctor/record">
              <Button size="lg">Record Exercise</Button>
            </Link>

            {/* Linked Patients */}
            <div>
              <h2 className="text-lg font-semibold mb-3">Your Patients</h2>
              {patientsLoading ? (
                <p className="text-sm text-muted-foreground">Loading patients...</p>
              ) : patients.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No patients linked yet. Share your doctor code to get started.
                </p>
              ) : (
                <div className="space-y-2 max-w-md">
                  {patients.map((p) => {
                    const name = [p.firstName, p.lastName].filter(Boolean).join(" ")
                    return (
                      <Card key={p.id} className="flex items-center justify-between p-4">
                        <div>
                          {name && <p className="font-medium">{name}</p>}
                          <p className={name ? "text-sm text-muted-foreground" : "font-medium"}>
                            {p.email}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAssignPatient(p)}
                        >
                          Assign Exercise
                        </Button>
                      </Card>
                    )
                  })}
                  <p className="text-xs text-muted-foreground pt-1">
                    {patients.length} patient{patients.length !== 1 && "s"} linked
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Assign Exercise Dialog */}
      <Dialog
        open={assignPatient !== null}
        onOpenChange={(open) => { if (!open) setAssignPatient(null) }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Assign Exercise to{" "}
              {assignPatient
                ? [assignPatient.firstName, assignPatient.lastName].filter(Boolean).join(" ") || assignPatient.email
                : ""}
            </DialogTitle>
          </DialogHeader>
          {assignPatient && (
            <RecordExercise
              patientId={assignPatient.id}
              onComplete={() => setAssignPatient(null)}
              doneLabel="Done"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
