// N3 — name-keyed session store backed by Netlify Blobs.
//
// The client keeps localStorage as its fast synchronous cache; this function
// is the cross-device mirror. Sync semantics: POST the current profile blob,
// GET the stored profile, and the client merges per-case by updatedAt.
//
//   GET  /api/store?name=<doctorName>   → { profile } | { profile: null }
//   POST /api/store  { name, profile }  → { ok: true }
//
// Blob context comes from NETLIFY_BLOBS_CONTEXT (base64 JSON, production) or
// event.blobs (base64 JSON, Lambda-compat local dev). No keys to wire — blobs
// live with the Netlify site.

const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'profiles';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (statusCode, body) => ({
  statusCode,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// Normalize the context shapes into { edgeURL, token, siteID }. The env
// context (production) carries siteID; in local dev it is absent from both the
// env and event.blobs, so fall back to the x-nf-site-id header ('unlinked').
function blobContext(event) {
  let ctx = null;
  const envRaw = process.env.NETLIFY_BLOBS_CONTEXT;
  if (envRaw) {
    try { ctx = JSON.parse(Buffer.from(envRaw, 'base64').toString('utf8')); } catch {}
  }
  if (!ctx && event && event.blobs) {
    try { ctx = JSON.parse(Buffer.from(event.blobs, 'base64').toString('utf8')); } catch {}
  }
  if (!ctx) return null;
  return {
    siteID: ctx.siteID || (event && event.headers && event.headers['x-nf-site-id']) || '',
    edgeURL: ctx.edgeURL || ctx.url,
    token: ctx.token,
  };
}

exports.handler = async (event) => {
  // Handle preflight CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  try {
    const ctx = blobContext(event);
    if (!ctx || !ctx.edgeURL || !ctx.token) {
      return json(500, { error: 'Blob store not configured in this environment.' });
    }
    const store = getStore({ name: STORE_NAME, siteID: ctx.siteID, edgeURL: ctx.edgeURL, token: ctx.token });

    if (event.httpMethod === 'GET') {
      const name = ((event.queryStringParameters || {}).name || '').trim();
      if (!name) return json(400, { error: 'Missing ?name=' });
      const profile = await store.get(name, { type: 'json' });
      return json(200, { profile: profile || null });
    }

    if (event.httpMethod === 'POST') {
      let body = {};
      try { body = JSON.parse(event.body || '{}'); } catch {}
      const name = String(body.name || '').trim();
      if (!name || !body.profile) return json(400, { error: 'Expected { name, profile }.' });
      await store.setJSON(name, body.profile);
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed.' });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
