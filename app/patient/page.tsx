"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { supabase } from "@/utils/supabase/client"
import { useRouter } from "next/navigation"

export default function PatientPage() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace("/login")
        return
      }
      setEmail(session.user.email ?? null)
    })
  }, [router])

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
        <p className="text-muted-foreground">Patient page — coming soon.</p>
      </div>
    </div>
  )
}
