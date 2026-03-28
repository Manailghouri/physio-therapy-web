"use client"

import { Button } from "@/components/ui/button"
import Link from "next/link"
import { supabase } from "@/utils/supabase/client"
import { useRouter } from "next/navigation"

export default function Home() {
  const router = useRouter()

  // if  session exists -> proceed to relevant screen (doctor or patient) - TODO
  // otherwise -> show log in / sign up - DONE

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/login")
  }

  return (
    <div>
      <h1>PhysioTherapy Guidance System</h1>
      <Button asChild>
        <Link href="/login">Log In</Link>
      </Button>
      <p>or</p>
      <Button asChild>
        <Link href="/signup">Sign Up</Link>
      </Button>
      <Button variant="outline" onClick={handleSignOut}>Sign Out</Button>
    </div>
  )
}
