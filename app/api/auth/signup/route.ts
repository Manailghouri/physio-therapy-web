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

    const { data: signData, error: signError } = await supabase.auth.signUp({ email, password })
    if (signError) return NextResponse.json({ error: signError.message }, { status: 400 })

    // signData.user may be undefined in some flows (depending on confirmation)
    const user = (signData as any)?.user || (signData as any)
    const userId = user?.id
    if (!userId) return NextResponse.json({ error: "No user id returned from auth" }, { status: 500 })

    // ROHA TO MANAIL 
    // there's no manual insert in users because i created a trigger
    // any row created in auth.users will trigger a new row being created in public.users


    // Insert minimal role-specific row. Migration/schema expects some non-null columns; use empty strings as placeholders.
    if (role === "patient") {
      await supabase.from("patients").insert([{ auth_id: userId, name: "", email, phone_number: "" }])
    } else if (role === "doctor") {
      const code = `doc_${Math.random().toString(36).slice(2, 9)}`
      await supabase
        .from("doctors")
        .insert([{ auth_id: userId, name: "", email, phone_number: "", hospital: "", bio: "", doctor_code: code }])
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}
