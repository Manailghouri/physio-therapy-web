"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { supabase } from "@/utils/supabase/client"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Dumbbell } from "lucide-react"

interface ExerciseAssignment {
  id: string
  name: string
  exercise_type: string
  video_url: string
  status: string | null
  notes: string | null
  assigned_at: string
}

export default function PatientPage() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)
  const [doctorName, setDoctorName] = useState<string | null>(null)
  const [hasDoctor, setHasDoctor] = useState(false)
  const [loading, setLoading] = useState(true)
  const [exercises, setExercises] = useState<ExerciseAssignment[]>([])

  // Link form state
  const [codeInput, setCodeInput] = useState("")
  const [linkError, setLinkError] = useState("")
  const [linking, setLinking] = useState(false)

  useEffect(() => {
    async function loadPatient() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.replace("/login")
        return
      }
      setEmail(session.user.email ?? null)

      // Fetch patient's doctor_id
      const { data: patient } = await supabase
        .from("patients")
        .select("*")
        .eq("id", session.user.id)
        .single()

      // Fetch assigned exercises directly — no API needed
      const { data: assignments } = await supabase
        .from("exercise_assignments")
        .select("id, name, exercise_type, video_url, status, notes, assigned_at")
        .eq("patient_id", session.user.id)
        .order("assigned_at", { ascending: false })

      setExercises(assignments ?? [])

      if (patient?.doctor_id) {
        const { data: doctorUser } = await supabase
          .from("users")
          .select("first_name, last_name")
          .eq("id", patient.doctor_id)
          .single()

        const name = doctorUser
          ? [doctorUser.first_name, doctorUser.last_name].filter(Boolean).join(" ")
          : ""
        setDoctorName(name || "Your Doctor")
        setHasDoctor(true)
      }

      setLoading(false)
    }
    loadPatient()
  }, [router])

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

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/login")
  }

  return (
    <div className="min-h-screen">
      <div className="flex items-center justify-between border-b px-6 py-3">
        <h1 className="text-lg font-semibold">Patient Dashboard</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{email}</span>
          <Button variant="outline" size="sm" onClick={handleSignOut}>Sign Out</Button>
        </div>
      </div>
      <div className="p-8">
        {loading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : hasDoctor ? (
          <div className="space-y-4">
            <div className="rounded-lg border p-6 max-w-md">
              <p className="text-sm text-muted-foreground mb-1">Linked to</p>
              <p className="text-lg font-semibold">{doctorName}</p>
            </div>
            {exercises.length === 0 ? (
              <p className="text-muted-foreground">
                Your doctor hasn&apos;t added any exercises yet.
              </p>
            ) : (
              <div>
                <h2 className="text-lg font-semibold mb-3">Assigned Exercises</h2>
                <div className="grid gap-3 max-w-2xl">
                  {exercises.map((ex) => (
                    <Link
                      key={ex.id}
                      href={`/patient/compare/${ex.id}`}
                      className="flex items-center gap-4 rounded-lg border p-4 hover:bg-accent transition-colors"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Dumbbell className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{ex.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {ex.exercise_type.replace(/_/g, " ")}
                          {ex.notes && ` · ${ex.notes}`}
                        </p>
                      </div>
                      <div className="text-xs text-muted-foreground shrink-0">
                        {new Date(ex.assigned_at).toLocaleDateString()}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="max-w-sm space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Link to your Doctor</h2>
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
              <p className="text-sm text-destructive">{linkError}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
