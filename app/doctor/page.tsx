"use client"

// ===================== IMPORTS =====================
import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RecordExercise } from "@/components/record-exercise"
import { supabase } from "@/utils/supabase/client"
import { useRouter } from "next/navigation"
import { getExerciseConfig } from "@/lib/exercise-config"
import { formatAngleName, getSimilarityColor, getSimilarityBg } from "@/lib/utils"
import {
  Users, Dumbbell, Activity, TrendingUp, Copy, Check,
  ChevronDown, ChevronRight, Plus, Loader2, Clock,
  Calendar, Target, User,
} from "lucide-react"
import { format, formatDistanceToNow } from "date-fns"


// ===================== TYPES =====================
interface PatientInfo {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
}

interface ExerciseAssignment {
  id: string
  name: string
  exercise_type: string
  video_url: string
  patient_id: string
  assigned_at: string
}

interface ExerciseSession {
  id: string
  patient_id: string
  assignment_id: string
  similarity_score: number
  reps_completed: number
  reps_expected: number
  state_matches: Record<string, number>
  angle_deviations: Record<string, number>
  duration_seconds: number
  completed_at: string
  valid_reps: number
  good_reps: number
  progress_score: number
  form_score: number
}

interface PatientData {
  info: PatientInfo
  assignments: ExerciseAssignment[]
  sessions: ExerciseSession[]
}


// ===================== MAIN COMPONENT =====================
export default function DoctorDashboard() {
  const router = useRouter()

  // ===================== USER STATE =====================
  const [email, setEmail] = useState<string | null>(null)
  const [doctorCode, setDoctorCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)

  // ===================== DASHBOARD DATA =====================
  const [patients, setPatients] = useState<PatientData[]>([])
  const [expandedPatient, setExpandedPatient] = useState<string | null>(null)
  const [expandedExercise, setExpandedExercise] = useState<string | null>(null)

  // ===================== ASSIGN EXERCISE DIALOG =====================
  const [assignPatient, setAssignPatient] = useState<PatientInfo | null>(null)


  // ===================== LOAD DASHBOARD =====================
  const loadDashboard = useCallback(async () => {

    // 🔐 Get session
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      router.replace("/login")
      return
    }

    setEmail(session.user.email ?? null)

    // ===================== FETCH DOCTOR CODE =====================
    const { data: doctor, error } = await supabase
      .from("doctors")
      .select("doctor_code")
      .eq("id", session.user.id)
      .single()

    if (error) {
      console.error("[doctor] Failed to fetch doctor_code:", error.message, error.code)
    }

    setDoctorCode(doctor?.doctor_code ?? null)


    // ===================== FETCH PATIENT IDS =====================
    const { data: patientRows } = await supabase
      .from("patients")
      .select("id")
      .eq("doctor_id", session.user.id)

    if (!patientRows || patientRows.length === 0) {
      setPatients([])
      setLoading(false)
      return
    }

    const patientIds = patientRows.map(p => p.id)


    // ===================== FETCH USER INFO =====================
    const { data: userRows } = await supabase
      .from("users")
      .select("id, first_name, last_name, email")
      .in("id", patientIds)


    // ===================== FETCH ASSIGNMENTS =====================
    const { data: assignmentRows } = await supabase
      .from("exercise_assignments")
      .select("id, name, exercise_type, video_url, patient_id, assigned_at")
      .eq("doctor_id", session.user.id)
      .order("assigned_at", { ascending: false })


    // ===================== FETCH SESSIONS =====================
    const { data: sessionRows } = await supabase
      .from("exercise_sessions")
      .select("*")
      .in("patient_id", patientIds)
      .order("completed_at", { ascending: false })


    // ===================== BUILD PATIENT DATA =====================
    const assembled: PatientData[] = patientIds.map(pid => {
      const userInfo = userRows?.find(u => u.id === pid)

      return {
        info: {
          id: pid,
          email: userInfo?.email ?? "Unknown",
          firstName: userInfo?.first_name ?? null,
          lastName: userInfo?.last_name ?? null,
        },
        assignments: (assignmentRows ?? []).filter(a => a.patient_id === pid),
        sessions: (sessionRows ?? []).filter(s => s.patient_id === pid),
      }
    })

    setPatients(assembled)
    setLoading(false)

  }, [router])


  // ===================== EFFECT =====================
  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])


  // ===================== COPY DOCTOR CODE =====================
  const handleCopy = async () => {
    if (!doctorCode) return

    await navigator.clipboard.writeText(doctorCode)
    setCopied(true)

    setTimeout(() => setCopied(false), 2000)
  }


  // ===================== SIGN OUT =====================
  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/login")
  }


  // ===================== STATS CALCULATION =====================
  const totalPatients = patients.length

  const totalAssignments = patients.reduce(
    (s, p) => s + p.assignments.length,
    0
  )

  const allSessions = patients.flatMap(p => p.sessions)
  const totalSessions = allSessions.length

  const avgScore = totalSessions > 0
    ? Math.round(
        allSessions.reduce((s, x) => s + x.similarity_score, 0) /
        totalSessions
      )
    : 0

  const sessionsWithProgress = allSessions.filter(
    s => s.progress_score > 0
  )

  const avgProgress = sessionsWithProgress.length > 0
    ? Math.round(
        sessionsWithProgress.reduce((s, x) => s + x.progress_score, 0) /
        sessionsWithProgress.length
      )
    : 0


  // ===================== LOADING UI =====================
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">
            Loading dashboard...
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
    {/* ===================== HEADER ===================== */}
     <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-xl border-b shadow-sm">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
<h1 className="text-xl font-bold tracking-tight">My Dashboard</h1>
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


          {/* ===================== MAIN ===================== */}


      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">

      {/* ===================== STATS ===================== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

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
          label="Avg Progress"
          value={
            sessionsWithProgress.length > 0
              ? `${avgProgress}%`
              : totalSessions > 0
              ? `${avgScore}%`
              : "—"
          }
          icon={<TrendingUp className="w-4 h-4" />}
          color="text-amber-600 dark:text-amber-400"
          bg="bg-amber-50 dark:bg-amber-950/30"
        />
      </div>

       {/* ===================== PATIENTS SECTION START ===================== */}
<div className="space-y-6">

  {/* ===== HEADER ===== */}
  <div className="flex items-center justify-between">

    <div>
      <h2 className="text-xl font-bold tracking-tight">
        Your Patients
      </h2>
      <p className="text-xs text-muted-foreground">
        Monitor progress and manage exercises
      </p>
    </div>

    {doctorCode && (
      <div className="px-3 py-1.5 rounded-full bg-primary/10 text-xs font-mono font-medium">
        Code: <span className="font-bold">{doctorCode}</span>
      </div>
    )}

  </div>


  {/* ===== CONTENT ===== */}
  {patients.length === 0 ? (

    /* ===== EMPTY STATE ===== */
    <Card className="rounded-2xl border shadow-sm">
      <CardContent className="py-16 text-center">

        <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />

        <p className="text-muted-foreground font-medium">
          No patients yet
        </p>

        <p className="text-sm text-muted-foreground mt-1">
          Share your code{" "}
          <span className="font-mono font-bold">{doctorCode}</span>{" "}
          to start linking patients 👨‍⚕️
        </p>

      </CardContent>
    </Card>

  ) : (

    /* ===== PATIENT LIST ===== */
    <div className="space-y-5">

      {patients.map((patient) => (
        <PatientCard
          key={patient.info.id}
          patient={patient}
          expanded={expandedPatient === patient.info.id}
          expandedExercise={expandedExercise}

          onToggle={() =>
            setExpandedPatient((prev) =>
              prev === patient.info.id ? null : patient.info.id
            )
          }

          onToggleExercise={(id) =>
            setExpandedExercise((prev) =>
              prev === id ? null : id
            )
          }

          onAssignExercise={() =>
            setAssignPatient(patient.info)
          }
        />
      ))}

    </div>
  )}

</div>
{/* ===================== PATIENTS SECTION END ===================== */}
      </main>

     {/* ===================== ASSIGN EXERCISE DIALOG START ===================== */}
<Dialog
  open={assignPatient !== null}
  onOpenChange={(open) => {
    if (!open) setAssignPatient(null)
  }}
>
  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border shadow-xl">

    {/* ===== HEADER ===== */}
    <DialogHeader className="pb-3 border-b">
      <DialogTitle className="text-lg font-semibold flex items-center gap-2">

        <span>Assign Exercise</span>

        {assignPatient && (
          <span className="text-primary font-bold">
            → {getPatientName(assignPatient)}
          </span>
        )}

      </DialogTitle>

      <p className="text-xs text-muted-foreground">
        Select and record an exercise for the patient
      </p>
    </DialogHeader>


    {/* ===== CONTENT ===== */}
    <div className="pt-4">

      {assignPatient && (
        <RecordExercise
          patientId={assignPatient.id}
          onComplete={() => {
            setAssignPatient(null)
            loadDashboard()
          }}
          doneLabel="Done"
        />
      )}

    </div>

  </DialogContent>
</Dialog>

    </div>
  )
}
{/* ===================== ASSIGN EXERCISE DIALOG END ===================== */}

// ===================== HELPER =====================
function getPatientName(info: PatientInfo): string {
  const name = [info.firstName, info.lastName]
    .filter(Boolean)
    .join(" ")

  return name || info.email
}


// ===================== STAT CARD COMPONENT =====================
function StatCard({
  label,
  value,
  icon,
  color,
  bg,
}: {
  label: string
  value: number | string
  icon: React.ReactNode
  color: string
  bg: string
}) {
  return (
    <Card className="rounded-2xl border shadow-sm hover:shadow-lg hover:scale-[1.02] transition-all duration-200">

      <CardContent className="flex items-center gap-4 py-5 px-5">

        {/* ===== ICON ===== */}
        <div className={`p-3 rounded-xl ${bg} shadow-inner`}>
          <span className={`${color} text-lg`}>
            {icon}
          </span>
        </div>

        {/* ===== TEXT ===== */}
        <div className="flex flex-col">

          <p className="text-3xl font-extrabold leading-none tracking-tight">
            {value}
          </p>

          <p className="text-xs text-muted-foreground mt-1">
            {label}
          </p>

        </div>

      </CardContent>

    </Card>
  )
}

// ===================== PATIENT CARD COMPONENT =====================
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

  // ===================== SESSION STATS =====================
  const totalSessions = sessions.length

  const avgScore = totalSessions > 0
    ? Math.round(
        sessions.reduce((s, x) => s + x.similarity_score, 0) / totalSessions
      )
    : null

  const lastSession = sessions[0]

  return (
  <Card className="overflow-hidden rounded-2xl border shadow-sm hover:shadow-lg hover:scale-[1.01] transition-all duration-200">

    {/* ===================== PATIENT HEADER ===================== */}
    <button
      onClick={onToggle}
      className="w-full text-left px-6 py-5 flex items-center gap-4 hover:bg-muted/40 transition-all"
    >

      {/* ===== AVATAR ===== */}
      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shadow-inner">
        <User className="w-5 h-5 text-primary" />
      </div>


      {/* ===== PATIENT INFO ===== */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-base truncate">
          {name}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {info.email}
        </p>
      </div>


      {/* ===== QUICK STATS ===== */}
      <div className="hidden sm:flex items-center gap-6">

        {/* Exercises */}
        <div className="text-center">
          <p className="text-lg font-bold leading-none">
            {assignments.length}
          </p>
          <p className="text-[10px] text-muted-foreground">
            Exercises
          </p>
        </div>

        {/* Sessions */}
        <div className="text-center">
          <p className="text-lg font-bold leading-none">
            {totalSessions}
          </p>
          <p className="text-[10px] text-muted-foreground">
            Sessions
          </p>
        </div>


        {/* ===== PROGRESS BAR (FIXED UI) ===== */}
        {avgScore !== null && (
          <div className="w-24">
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${avgScore}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 text-center">
              {avgScore}%
            </p>
          </div>
        )}


        {/* ===== LAST ACTIVE ===== */}
        {lastSession && (
          <div className="text-center">
            <p className="text-xs font-semibold">
              {formatDistanceToNow(
                new Date(lastSession.completed_at),
                { addSuffix: true }
              )}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Last Active
            </p>
          </div>
        )}

      </div>



       {/* ===================== EXPAND ARROW ===================== */}
{expanded ? (
  <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0" />
) : (
  <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
)}
</button>


{/* ===================== EXPANDED DETAIL START ===================== */}
{expanded && (
  <div className="border-t px-6 py-5 space-y-5 bg-muted/30 backdrop-blur-sm">

    {/* ===== MOBILE STATS ===== */}
    <div className="flex sm:hidden gap-3 flex-wrap">
      <MiniStat label="Exercises" value={assignments.length} />
      <MiniStat label="Sessions" value={totalSessions} />
      {avgScore !== null && (
        <MiniStat label="Avg Score" value={`${avgScore}%`} />
      )}
    </div>


    {/* ===================== ASSIGNED EXERCISES ===================== */}
    {assignments.length === 0 ? (

      /* ===== EMPTY STATE ===== */
      <div className="text-center py-8">
        <Dumbbell className="w-10 h-10 text-muted-foreground mx-auto mb-3" />

        <p className="text-sm text-muted-foreground mb-3">
          No exercises assigned yet
        </p>

        <Button size="sm" onClick={onAssignExercise}>
          <Plus className="w-4 h-4 mr-1" />
          Assign Exercise
        </Button>
      </div>

    ) : (

      <>
        {/* ===== HEADER ===== */}
        <div className="flex items-center justify-between">

          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Assigned Exercises
          </h3>

          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onAssignExercise()
            }}
          >
            <Plus className="w-4 h-4 mr-1" />
            Assign
          </Button>

        </div>


        {/* ===== EXERCISE LIST ===== */}
        <div className="space-y-3">

          {assignments.map((assignment) => {
            const exerciseSessions = sessions
              .filter((s) => s.assignment_id === assignment.id)
              .sort(
                (a, b) =>
                  new Date(b.completed_at).getTime() -
                  new Date(a.completed_at).getTime()
              )

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
{/* ===================== EXPANDED DETAIL END ===================== */}

// ===================== MINI STAT COMPONENT =====================
function MiniStat({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    // Small stat card used in mobile / compact views
    <div className="bg-background rounded-md border px-3 py-1.5 text-center">

      {/* Value */}
      <p className="font-semibold text-sm">
        {value}
      </p>

      {/* Label */}
      <p className="text-[10px] text-muted-foreground">
        {label}
      </p>

    </div>
  )
}



// ===================== EXERCISE CARD COMPONENT =====================
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

  // ===================== EXERCISE CONFIG =====================
  // Get display config (name, etc.)
  const config = getExerciseConfig(assignment.exercise_type)

  // ===================== SESSION DATA =====================
  const sessionCount = sessions.length

  // Check if new progress system exists
  const hasProgressData = sessions.some(
    (s) => s.progress_score > 0
  )

  // ===================== AVERAGE SCORE =====================
  // Use progress_score if available, otherwise fallback to similarity_score
  const avgScore =
    sessionCount > 0
      ? hasProgressData
        ? Math.round(
            sessions
              .filter((s) => s.progress_score > 0)
              .reduce((s, x) => s + x.progress_score, 0) /
              sessions.filter((s) => s.progress_score > 0).length
          )
        : Math.round(
            sessions.reduce((s, x) => s + x.similarity_score, 0) /
              sessionCount
          )
      : null


  // ===================== TREND CALCULATION =====================
  // Compare latest session vs previous average
  let trend: "up" | "down" | "stable" | null = null

  if (sessions.length >= 2) {
    const scoreKey = hasProgressData
      ? "progress_score"
      : "similarity_score"

    const recent = sessions[0][scoreKey]

    const prevAvg =
      sessions
        .slice(1)
        .reduce((s, x) => s + x[scoreKey], 0) /
      (sessions.length - 1)

    if (recent > prevAvg + 3) {
      trend = "up"
    } else if (recent < prevAvg - 3) {
      trend = "down"
    } else {
      trend = "stable"
    }
  }
  return (
<div className="bg-background rounded-xl border shadow-sm hover:shadow-md transition-all overflow-hidden">
        <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-center gap-4 text-sm hover:bg-muted/50 transition-colors"
      >
        {/* Exercise icon */}
        <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Dumbbell className="w-4 h-4 text-primary" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{assignment.name}</p>
          <p className="text-xs text-muted-foreground">
            {config?.name ?? assignment.exercise_type}
            {assignment.assigned_at && (
              <> &middot; Assigned {format(new Date(assignment.assigned_at), "MMM d")}</>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {sessionCount > 0 && (
            <div className="text-right">
              <div className="flex items-center gap-1">
                {avgScore !== null && (
                 <span className={`text-lg font-extrabold ${getSimilarityColor(avgScore)}`}>
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
<div className="bg-muted/40 rounded-lg border">
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="w-full text-left px-3 py-2 flex items-center gap-3 text-sm hover:bg-muted transition-colors rounded-md"
      >
        <Calendar className="w-3 h-3 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground w-24 shrink-0">
          {format(new Date(session.completed_at), "MMM d, h:mm a")}
        </span>
        <div className="flex-1 flex items-center gap-3 flex-wrap">
          {/* Progress or Similarity */}
          {session.progress_score > 0 ? (
            <div className="flex items-center gap-1.5">
              <div className="w-16 bg-muted rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-full rounded-full ${getSimilarityBg(session.progress_score)}`}
                  style={{ width: `${session.progress_score}%` }}
                />
              </div>
              <span className={`text-xs font-semibold min-w-[2rem] ${getSimilarityColor(session.progress_score)}`}>
                {session.progress_score}%
              </span>
              <span className="text-[10px] text-muted-foreground">progress</span>
            </div>
          ) : (
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
          )}
          {/* Valid/Good Reps or fallback to old reps */}
          {session.valid_reps > 0 ? (
            <span className="text-xs text-muted-foreground">
              <Target className="w-3 h-3 inline mr-0.5" />
              {session.valid_reps} valid · {session.good_reps} good / {session.reps_completed}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              <Target className="w-3 h-3 inline mr-0.5" />
              {session.reps_completed}/{session.reps_expected} reps
            </span>
          )}
          {/* Form score badge */}
          {session.form_score > 0 && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              session.form_score >= 80
                ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                : session.form_score >= 50
                  ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400"
                  : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
            }`}>
              Form: {session.form_score}%
            </span>
          )}
        </div>
        {showDetails
          ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
          : <ChevronRight className="w-3 h-3 text-muted-foreground" />
        }
      </button>

      {showDetails && (
        <div className="px-3 pb-3 space-y-2">
          {/* Progress metrics */}
          {session.progress_score > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">
                Progress: {session.progress_score}%
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400">
                Form: {session.form_score}%
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400">
                Valid: {session.valid_reps} · Good: {session.good_reps}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-700 dark:bg-gray-950/40 dark:text-gray-400">
                Similarity: {session.similarity_score}%
              </span>
            </div>
          )}

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
                    {formatAngleName(angle)}: ±{Math.round(deviation)}°
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
