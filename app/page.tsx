"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { supabase } from "@/utils/supabase/client"
import { useRouter } from "next/navigation"

export default function Home() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    async function checkSession() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setLoading(false)
        return
      }

      setEmail(session.user.email ?? null)

      // Fetch role from public.users
      const { data } = await supabase
        .from("users")
        .select("role")
        .eq("id", session.user.id)
        .single()

      setRole(data?.role ?? null)
      setLoading(false)
    }

    checkSession()
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/login")
  }

  useEffect(() => {
    if (role === "patient") {
      router.replace("/patient")
    } else if (role === "doctor") {
      router.replace("/doctor")
    }
  }, [role, router])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (!role) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="space-y-4 text-center">
          <h1 className="text-3xl font-bold">Physiotherapy Guidance System</h1>
          <div className="flex gap-3 justify-center">
            <Button asChild>
              <Link href="/login">Log In</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/signup">Sign Up</Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return null
}