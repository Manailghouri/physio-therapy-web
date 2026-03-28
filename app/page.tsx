"use client"

import { Button } from "@/components/ui/button"
import Link from "next/link"



export default function Home() {

  // if  session exists -> proceed to relevant screen (doctor or patient)
  // otherwise -> show log in / sign up

  
  return (
    <div>
      <h1>PhysioTherapy Guidance System</h1>
      <Button>
        <Link href={"/login"}>Log In</Link>
      </Button>
      <p>or</p>
      <Button>
        <Link href={"/signup"}>Sign Up</Link>
      </Button>
    </div>
  )
}
