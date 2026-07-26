import { createClient } from 'jsr:@supabase/supabase-js@2'
import { formatGermanDate } from '../_shared/letter-validators.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

type DeadlineType = 'beweislastumkehr_30d' | 'gewaehrleistung_30d'

type Candidate = {
  user_id: string
  type: DeadlineType
  related_id: string
  scheduled_for: string
  content: {
    title: string
    body: string
    deep_link: string
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Service role: this runs from cron, no user JWT
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const today = new Date()
  const targetDate = new Date(today)
  targetDate.setDate(targetDate.getDate() + 30)
  const targetIso = isoDate(targetDate)
  const todayIso = isoDate(today)

  // Notifications fire at 09:00 UTC (≈ 11:00 CEST in summer, 10:00 CET in winter)
  const scheduleAt = new Date(today)
  scheduleAt.setUTCHours(9, 0, 0, 0)
  const scheduleIso = scheduleAt.toISOString()

  const { data: bluProducts, error: bluError } = await supabase
    .from('products')
    .select('id, user_id, name, beweislastumkehr_end')
    .eq('beweislastumkehr_end', targetIso)
    .eq('status', 'active')
  if (bluError) return jsonResponse({ error: bluError.message }, 500)

  const { data: gwlProducts, error: gwlError } = await supabase
    .from('products')
    .select('id, user_id, name, warranty_end_date')
    .eq('warranty_end_date', targetIso)
    .eq('status', 'active')
  if (gwlError) return jsonResponse({ error: gwlError.message }, 500)

  const candidates: Candidate[] = [
    ...(bluProducts ?? []).map(
      (p): Candidate => ({
        user_id: p.user_id,
        type: 'beweislastumkehr_30d',
        related_id: p.id,
        scheduled_for: scheduleIso,
        content: {
          title: 'Beweislastumkehr endet in 30 Tagen',
          body: `Ab ${formatGermanDate(p.beweislastumkehr_end)} musst du selbst beweisen, dass „${p.name}" defekt war.`,
          deep_link: `receipto://product/${p.id}`,
        },
      })
    ),
    ...(gwlProducts ?? []).map(
      (p): Candidate => ({
        user_id: p.user_id,
        type: 'gewaehrleistung_30d',
        related_id: p.id,
        scheduled_for: scheduleIso,
        content: {
          title: 'Gewährleistung läuft bald ab',
          body: `Die Gewährleistung für „${p.name}" endet am ${formatGermanDate(p.warranty_end_date)}.`,
          deep_link: `receipto://product/${p.id}`,
        },
      })
    ),
  ]

  if (candidates.length === 0) {
    return jsonResponse({ success: true, scheduled: 0, skipped: 0 })
  }

  // De-dup: skip if same (user_id, type, related_id) already scheduled today
  const { data: existing } = await supabase
    .from('notifications')
    .select('user_id, type, related_id')
    .in('type', ['beweislastumkehr_30d', 'gewaehrleistung_30d'])
    .in(
      'related_id',
      candidates.map((c) => c.related_id)
    )
    .gte('created_at', `${todayIso}T00:00:00Z`)

  const existingKeys = new Set(
    (existing ?? []).map((n) => `${n.user_id}:${n.type}:${n.related_id}`)
  )

  const fresh = candidates.filter(
    (c) => !existingKeys.has(`${c.user_id}:${c.type}:${c.related_id}`)
  )

  if (fresh.length > 0) {
    const { error: insertError } = await supabase.from('notifications').insert(fresh)
    if (insertError) return jsonResponse({ error: insertError.message }, 500)
  }

  return jsonResponse({
    success: true,
    scheduled: fresh.length,
    skipped: candidates.length - fresh.length,
  })
})
