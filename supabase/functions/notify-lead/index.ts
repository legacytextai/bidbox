import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3.23.8';

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/resend';
const NOTIFY_TO = 'bidbox.app.us@gmail.com';

const BodySchema = z.object({
  email: z.string().trim().email().max(255),
  form_type: z.enum(['guide', 'trial_request', 'newsletter']),
  source_path: z.string().max(500).nullable().optional(),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: 'Invalid payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { email, form_type, source_path } = parsed.data;

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
      console.error('Missing gateway credentials');
      return new Response(JSON.stringify({ error: 'Email not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const labels: Record<string, string> = {
      guide: 'Guide download',
      trial_request: 'Trial request',
      newsletter: 'Newsletter subscribe',
    };
    const label = labels[form_type];

    const res = await fetch(`${GATEWAY_URL}/emails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: 'BidBox Leads <onboarding@resend.dev>',
        to: [NOTIFY_TO],
        reply_to: email,
        subject: `[BidBox] New ${label}: ${email}`,
        html: `<h2>New BidBox lead</h2>
<p><strong>Tag:</strong> ${form_type}</p>
<p><strong>Email:</strong> ${email}</p>
<p><strong>Source:</strong> ${source_path ?? '(unknown)'}</p>
<p><strong>Received:</strong> ${new Date().toISOString()}</p>`,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`Resend gateway failed [${res.status}]: ${body}`);
      return new Response(JSON.stringify({ error: 'Send failed', status: res.status, details: body }), {
        status: res.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('notify-lead error:', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
