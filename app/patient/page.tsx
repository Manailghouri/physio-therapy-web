"use client"

// ===================== IMPORTS =====================
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { supabase } from "@/utils/supabase/client"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { getExerciseConfig } from "@/lib/exercise-config"
import { formatDistanceToNow } from "date-fns"
import { Dumbbell, Play, Loader2 } from "lucide-react"
import { getSimilarityColor } from "@/lib/utils"

// ===================== TYPES =====================
interface Assignment {
  id: string
  name: string
  exercise_type: string
  assigned_at: string
}

interface SessionSummary {
  assignment_id: string
  count: number
  avg_score: number
  last_completed: string
}

// ===================== MAIN COMPONENT =====================
export default function PatientPage() {
  const router = useRouter()

  // ===================== USER STATE =====================
  const [email, setEmail] = useState<string | null>(null)
  const [doctorName, setDoctorName] = useState<string | null>(null)
  const [hasDoctor, setHasDoctor] = useState(false)
  const [loading, setLoading] = useState(true)

  // ===================== DATA STATE =====================
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [sessionSummaries, setSessionSummaries] =
    useState<Map<string, SessionSummary>>(new Map())

  // ===================== LINK DOCTOR STATE =====================
  const [codeInput, setCodeInput] = useState("")
  const [linkError, setLinkError] = useState("")
  const [linking, setLinking] = useState(false)

  // ===================== LOAD PATIENT DATA =====================
  useEffect(() => {
    async function loadPatient() {
      // 🔐 Get current session
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        router.replace("/login")
        return
      }

      setEmail(session.user.email ?? null)

      // ===================== FETCH PATIENT =====================
      const { data: patient } = await supabase
        .from("patients")
        .select("*")
        .eq("id", session.user.id)
        .single()

      // ===================== IF DOCTOR LINKED =====================
      if (patient?.doctor_id) {

        // 👨‍⚕️ Get doctor info
        const { data: doctorUser } = await supabase
          .from("users")
          .select("first_name, last_name")
          .eq("id", patient.doctor_id)
          .single()

        const name = doctorUser
          ? [doctorUser.first_name, doctorUser.last_name]
              .filter(Boolean)
              .join(" ")
          : ""

        setDoctorName(name || "Your Doctor")
        setHasDoctor(true)

        // ===================== FETCH ASSIGNMENTS =====================
        const { data: exerciseRows } = await supabase
          .from("exercise_assignments")
          .select("id, name, exercise_type, assigned_at")
          .eq("patient_id", session.user.id)
          .order("assigned_at", { ascending: false })

        if (exerciseRows && exerciseRows.length > 0) {
          setAssignments(exerciseRows)

          // ===================== FETCH SESSIONS =====================
          const { data: sessionRows } = await supabase
            .from("exercise_sessions")
            .select("assignment_id, similarity_score, completed_at")
            .eq("patient_id", session.user.id)
            .order("completed_at", { ascending: false })

          // ===================== BUILD SUMMARY =====================
          if (sessionRows) {
            const summaryMap = new Map<string, SessionSummary>()

            for (const s of sessionRows) {
              const existing = summaryMap.get(s.assignment_id)

              if (existing) {
                existing.count++
                existing.avg_score =
                  (existing.avg_score * (existing.count - 1) +
                    s.similarity_score) / existing.count
              } else {
                summaryMap.set(s.assignment_id, {
                  assignment_id: s.assignment_id,
                  count: 1,
                  avg_score: s.similarity_score,
                  last_completed: s.completed_at,
                })
              }
            }

            setSessionSummaries(summaryMap)
          }
        }
      }

      setLoading(false)
    }

    loadPatient()
  }, [router])

  // ===================== LINK DOCTOR FUNCTION =====================
  const handleLinkDoctor = async (e: React.FormEvent) => {
    e.preventDefault()

    setLinkError("")
    setLinking(true)

    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      setLinkError("Session expired. Please log in again.")
      setLinking(false)
      return
    }

    const res = await fetch("/api/patient/link-doctor", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ doctor_code: codeInput }),
    })

    const data = await res.json()
    setLinking(false)

    if (!res.ok) {
      setLinkError(data.error || "Failed to link doctor")
      return
    }

    setDoctorName(data.doctor_name ?? "your doctor")
    setHasDoctor(true)
    setCodeInput("")
  }

  // ===================== SIGN OUT =====================
  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/login")
  }





  return (
  <div className="min-h-screen">

 {/* ===================== HEADER START ===================== */}
<header className="sticky top-0 z-20 bg-background/80 backdrop-blur-xl border-b shadow-sm">

  <div className="flex items-center justify-between px-6 py-4">
    <div className="flex flex-col">
      <h1 className="text-xl font-bold tracking-tight">
        My Exercise
      </h1>
      <p className="text-xs text-muted-foreground">
        Perform your assigned exercises
      </p>
    </div>
    <div className="flex items-center gap-4">

      <span className="text-sm text-muted-foreground hidden sm:inline">
        {email}
      </span>

      <Button
        variant="outline"
        size="sm"
        onClick={handleSignOut}
        className="rounded-lg"
      >
        Sign Out
      </Button>

    </div>

  </div>
</header>
{/* ===================== HEADER END ===================== */}


    {/* ===================== MAIN CONTAINER START ===================== */}
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">

      {/* ===================== LOADING STATE ===================== */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>

      ) : hasDoctor ? (

        <div className="space-y-6">

          {/* ===================== DOCTOR CARD START ===================== */}
          <div className="flex items-center gap-4 p-4 rounded-2xl border bg-gradient-to-r from-primary/10 to-transparent shadow-sm">

            {/* Avatar */}
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
              <span className="text-sm font-bold text-primary">
                {doctorName?.charAt(0)?.toUpperCase() || "D"}
              </span>
            </div>

            {/* Doctor Info */}
            <div>
              <p className="text-xs text-muted-foreground">
                Assigned Doctor
              </p>
              <p className="font-semibold text-lg">
                {doctorName}
              </p>
            </div>

          </div>
          {/* ===================== DOCTOR CARD END ===================== */}


          {/* ===================== ASSIGNED EXERCISES START ===================== */}
          {assignments.length === 0 ? (

            <Card>
              <CardContent className="py-12 text-center">
                <Dumbbell className="w-10 h-10 text-muted-foreground mx-auto mb-3" />

                <p className="text-muted-foreground font-medium">
                  No exercises yet
                </p>

                <p className="text-sm text-muted-foreground mt-1">
                  Your doctor will assign exercises soon 💪
                </p>
              </CardContent>
            </Card>

          ) : (

            <div className="space-y-6">

              {/* ===== TITLE ===== */}
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Your Exercises ({assignments.length})
              </h2>


              {/* ===== EXERCISE LIST ===== */}
              {assignments.map((assignment) => {
                const config = getExerciseConfig(assignment.exercise_type)
                const summary = sessionSummaries.get(assignment.id)

                return (
                  <Link
                    key={assignment.id}
                    href={`/patient/compare/${assignment.id}`}
                    className="block"
                  >

                    {/* ===== CARD ===== */}
                    <Card className="rounded-2xl border shadow-sm hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer">

                      <CardContent className="flex items-center gap-4 py-5 px-5">

                        {/* ===== ICON ===== */}
                        <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                          <Dumbbell className="w-7 h-7 text-primary" />
                        </div>


                        {/* ===== TEXT INFO ===== */}
                        <div className="flex-1 min-w-0">

                          <p className="font-semibold text-base">
                            {assignment.name}
                          </p>

                          <p className="text-xs text-muted-foreground">
                            {config?.name ?? assignment.exercise_type}
                          </p>


                          {/* ===== SESSION INFO ===== */}
                          {summary ? (
                            <>
                              <div className="flex items-center gap-3 mt-1">
                                <span className="text-xs text-muted-foreground">
                                  {summary.count} session{summary.count !== 1 ? "s" : ""}
                                </span>

                                <span className={`text-xs font-semibold ${getSimilarityColor(summary.avg_score)}`}>
                                  Avg: {Math.round(summary.avg_score)}%
                                </span>

                                <span className="text-xs text-muted-foreground">
                                  Last: {formatDistanceToNow(
                                    new Date(summary.last_completed),
                                    { addSuffix: true }
                                  )}
                                </span>
                              </div>

                              {/* ===== PROGRESS BAR ===== */}
                              <div className="mt-2 w-full h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary transition-all"
                                  style={{ width: `${summary.avg_score}%` }}
                                />
                              </div>
                            </>
                          ) : (
                            <p className="text-xs text-muted-foreground mt-1">
                              Not started yet
                            </p>
                          )}

                        </div>


                        {/* ===== RIGHT SIDE (SCORE + ACTION) ===== */}
                        <div className="flex flex-col items-end gap-1">

                          {summary && (
                            <>
                              <p className={`text-xl font-extrabold ${getSimilarityColor(summary.avg_score)}`}>
                                {Math.round(summary.avg_score)}%
                              </p>

                              <p className={`text-xs ${
                                summary.avg_score > 80
                                  ? "text-green-500"
                                  : summary.avg_score > 60
                                  ? "text-yellow-500"
                                  : "text-red-500"
                              }`}>
                                {summary.avg_score > 80
                                  ? "Excellent"
                                  : summary.avg_score > 60
                                  ? "Good"
                                  : "Needs work"}
                              </p>
                            </>
                          )}

                          <Play className="w-5 h-5 text-primary mt-1" />

                        </div>

                      </CardContent>
                    </Card>

                  </Link>
                )
              })}

            </div>
          )}
          {/* ===================== ASSIGNED EXERCISES END ===================== */}

        </div>

      ) : (

        /* ===================== LINK DOCTOR STATE ===================== */
        <div className="max-w-sm mx-auto space-y-4 pt-12">

          <div className="text-center">
            <h2 className="text-lg font-semibold">
              Link to your Doctor
            </h2>

            <p className="text-sm text-muted-foreground mt-1">
              Enter the code your doctor gave you to get started.
            </p>
          </div>

          <form onSubmit={handleLinkDoctor} className="flex gap-2">
            <Input
              placeholder="e.g. DR-A7X3"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              required
            />

            <Button type="submit" disabled={linking}>
              {linking ? "Linking..." : "Link"}
            </Button>
          </form>

          {linkError && (
            <p className="text-sm text-destructive">
              {linkError}
            </p>
          )}

        </div>

      )}
    </div>
    {/* ===================== MAIN CONTAINER END ===================== */}

  </div>
  )
}