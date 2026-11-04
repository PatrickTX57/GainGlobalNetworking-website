// Cloudflare Pages Function: POST /api/register
//
// Receives the Guest Registration form, checks the Cloudflare Turnstile token
// on the server, then forwards the submission to the n8n workflow
// "Gain Global — Contact Form to Airtable" (Airtable, Google Sheet, Mailchimp,
// Salesmsg).
//
// Environment variables (Cloudflare dashboard -> Workers & Pages ->
// gainglobalnetworking-website -> Settings -> Variables and Secrets):
//   TURNSTILE_SECRET_KEY  (Secret, required)  Turnstile widget secret key
//   N8N_FORM_SECRET       (Secret, optional)  sent to n8n as X-GGN-Form-Secret
//                                             so n8n can ignore anything that
//                                             didn't come through this function
//   N8N_WEBHOOK_URL       (Text, optional)    overrides the default webhook URL

const DEFAULT_N8N_WEBHOOK_URL =
  'https://bloomtx.app.n8n.cloud/webhook/gain-global-contact-form';
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_ACTION = 'guest-registration';

const REQUIRED = ['first_name', 'last_name', 'email', 'phone', 'profession'];
const MAX_LEN = 200;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function clean(value) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_LEN) : '';
}

function isOn(value) {
  return value === true || value === 'on' || value === 'true';
}

export async function onRequestPost({ request, env }) {
  let data;
  try {
    const type = request.headers.get('Content-Type') || '';
    if (type.includes('application/json')) {
      data = await request.json();
    } else {
      data = Object.fromEntries(await request.formData());
    }
  } catch {
    return json({ success: false, message: 'Invalid submission.' }, 400);
  }

  // Honeypot: real visitors never see or tick this box. Pretend it worked.
  if (isOn(data.botcheck)) return json({ success: true });

  for (const field of REQUIRED) {
    if (!clean(data[field])) {
      return json({ success: false, message: 'Please fill in all required fields.' }, 400);
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(data.email))) {
    return json({ success: false, message: 'Please enter a valid email address.' }, 400);
  }

  // --- Turnstile check ---
  const rawToken = data['cf-turnstile-response'];
  const token = typeof rawToken === 'string' ? rawToken.trim().slice(0, 2048) : '';
  if (!token) {
    return json({ success: false, message: 'Please complete the security check before sending.' }, 400);
  }
  if (!env.TURNSTILE_SECRET_KEY) {
    console.error('TURNSTILE_SECRET_KEY is not set');
    return json({ success: false, message: 'The form is not fully set up yet. Please email info@gainglobalnetworking.com.' }, 500);
  }

  const verifyBody = new FormData();
  verifyBody.append('secret', env.TURNSTILE_SECRET_KEY);
  verifyBody.append('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) verifyBody.append('remoteip', ip);

  let outcome;
  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body: verifyBody });
    outcome = await res.json();
  } catch (err) {
    console.error('Turnstile siteverify failed', err);
    return json({ success: false, message: 'Something went wrong. Please try again.' }, 502);
  }

  // The test secret keys return no action, so only check it when present.
  if (!outcome.success || (outcome.action && outcome.action !== TURNSTILE_ACTION)) {
    console.warn('Turnstile rejected', outcome['error-codes'], outcome.action);
    return json({ success: false, message: 'The security check failed. Please refresh the page and try again.' }, 403);
  }

  // --- Forward to n8n ---
  const payload = {
    firstName: clean(data.first_name),
    lastName: clean(data.last_name),
    email: clean(data.email),
    phone: clean(data.phone),
    profession: clean(data.profession),
    referredBy: clean(data.referred_by),
    emailOptIn: isOn(data.email_optin),
    smsOptIn: isOn(data.sms_optin),
  };

  const headers = { 'Content-Type': 'application/json' };
  if (env.N8N_FORM_SECRET) headers['X-GGN-Form-Secret'] = env.N8N_FORM_SECRET;

  try {
    const res = await fetch(env.N8N_WEBHOOK_URL || DEFAULT_N8N_WEBHOOK_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`n8n responded ${res.status}`);
  } catch (err) {
    console.error('Forwarding to n8n failed', err);
    return json({ success: false, message: 'Something went wrong. Please try again, or email info@gainglobalnetworking.com.' }, 502);
  }

  return json({ success: true });
}

export function onRequest() {
  return json({ success: false, message: 'Method not allowed.' }, 405);
}
