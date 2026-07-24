import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import type { Database } from '@receipto/database'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: string } | null
  const email = body?.email?.trim().toLowerCase()

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Ungültige E-Mail-Adresse.' }, { status: 400 })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Server misconfigured.' }, { status: 500 })
  }

  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey)
  const { error } = await supabase.from('waitlist').insert({ email, source: 'landing' })

  // 23505 = unique violation. Treat duplicate signup as success.
  if (error && error.code !== '23505') {
    console.error('Waitlist insert failed:', error)
    return NextResponse.json({ error: 'Speichern fehlgeschlagen.' }, { status: 500 })
  }

  const resendKey = process.env.RESEND_API_KEY
  if (resendKey) {
    try {
      const resend = new Resend(resendKey)
      await resend.emails.send({
        from: 'Receipto <onboarding@resend.dev>',
        to: email,
        subject: 'Willkommen auf der Receipto-Warteliste',
        text: 'Danke! Wir melden uns, sobald Receipto im App Store verfügbar ist.\n\n— Receipto',
      })
    } catch (e) {
      // Don't fail the request if confirmation email bounces.
      // Log only the message — the Resend SDK error can embed the request
      // payload (including the recipient's email address).
      console.error('Confirmation email failed:', e instanceof Error ? e.message : 'unknown error')
    }
  }

  return NextResponse.json({ success: true })
}
