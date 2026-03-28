import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // allow build to succeed but runtime will error if env missing
  console.warn("Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY")
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { email, password, role } = body

    if (!email || !password || !role) {
      return NextResponse.json({ error: "email, password and role are required" }, { status: 400 })
    }

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: "Server missing Supabase config" }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    console.log(`[signup] Attempting signup for ${email} as ${role}`)

    const { data: signData, error: signError } = await supabase.auth.signUp({ email, password })

    if (signError) {
      console.error(`[signup] Auth error:`, signError.message, `| status: ${signError.status}`)
      return NextResponse.json({ error: `Auth failed: ${signError.message}` }, { status: 400 })
    }

    const userId = signData?.user?.id
    console.log(`[signup] Auth user created:`, { userId, email, identities: signData?.user?.identities?.length })

    // If identities is empty, the email is already registered
    if (!userId || signData?.user?.identities?.length === 0) {
      console.warn(`[signup] User already exists or no ID returned for ${email}`)
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 })
    }

    // The trigger on auth.users already created the public.users row.
    // Now set the role on it.
    if (role !== "patient" && role !== "doctor") {
      console.error(`[signup] Invalid role: ${role}`)
      return NextResponse.json({ error: `Invalid role "${role}". Must be "patient" or "doctor"` }, { status: 400 })
    }

    const { error: updateErr } = await supabase
      .from("users")
      .update({ role })
      .eq("id", userId)
    if (updateErr) {
      console.error(`[signup] Failed to set role on users row:`, updateErr.message, updateErr.details)
      return NextResponse.json({ error: `Account created but role update failed: ${updateErr.message}` }, { status: 500 })
    }

    console.log(`[signup] Success: ${email} registered as ${role}`)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error(`[signup] Unexpected error:`, err)
    return NextResponse.json({ error: `Unexpected error: ${err?.message || String(err)}` }, { status: 500 })
  }
}
