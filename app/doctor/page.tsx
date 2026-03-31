"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
  const [doctorCode, setDoctorCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [patients, setPatients] = useState<LinkedPatient[]>([])
  const [patientsLoading, setPatientsLoading] = useState(true)

  useEffect(() => {
    async function loadDoctor() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.replace("/login")
        return
      }
      setEmail(session.user.email ?? null)

      const { data, error } = await supabase
        .from("doctors")
        .select("doctor_code")
        .eq("id", session.user.id)
        .single()

      if (error) {
        console.error("[doctor] Failed to fetch doctor_code:", error.message, error.code)
      }

      setDoctorCode(data?.doctor_code ?? null)

      // Fetch linked patients
      const { data: patientRows, error: patientsErr } = await supabase
        .from("patients")
        .select("id")
        .eq("doctor_id", session.user.id)

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

  return (
    <div className="min-h-screen">
      <div className="flex items-center justify-between border-b px-6 py-3">
        <h1 className="text-lg font-semibold">Doctor Dashboard</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{email}</span>
          <Button variant="outline" size="sm" onClick={handleSignOut}>Sign Out</Button>
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
    </div>
  )
}
