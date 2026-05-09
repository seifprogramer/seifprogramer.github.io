// ============================================
// VOLDEX API — Same system as Cloudflare Worker
// Secrets: VOLDEX_API_KEYS, GEMINI_BACKENDS
// Auth: Bearer API-VOLDEX-...
// ============================================

// Hardcoded fallback (same as Worker — remove if using env vars)
const VOLDEX_KEYS = process.env.VOLDEX_API_KEYS 
  ? JSON.parse(process.env.VOLDEX_API_KEYS)
  : ["API-VOLDEX-1g0tfr33r0buxl0l-r1oo", "API-VOLDEX-g1ft-rand0m", "API-VOLDEX-g1v3away-f0ry0u"];

const GEMINI_BACKENDS = process.env.GEMINI_BACKENDS
  ? JSON.parse(process.env.GEMINI_BACKENDS)
  : [];

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- AUTH: Same as Worker ---
  const authHeader = req.headers.authorization || '';
  const providedKey = authHeader.replace('Bearer ', '').trim();

  if (VOLDEX_KEYS.length > 0 && !VOLDEX_KEYS.includes(providedKey)) {
    return res.status(401).json({ 
      error: { message: 'Invalid API key. Required format: Bearer API-VOLDEX-...' } 
    });
  }

  try {
    const body = req.body;

    // --- GEMINI BACKENDS: Same rotation as Worker ---
    const backends = GEMINI_BACKENDS;
    if (backends.length === 0) {
      return res.status(500).json({ 
        error: { message: 'No Gemini backends configured. Set GEMINI_BACKENDS in Vercel env.' } 
      });
    }

    let lastError = null;

    for (const backend of backends) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${backend.model}:streamGenerateContent?alt=sse&key=${backend.key}`;

        const geminiRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (geminiRes.status === 429) { lastError = `${backend.name}: Busy`; continue; }
        if (geminiRes.status === 403) { lastError = `${backend.name}: Key invalid`; continue; }
        if (geminiRes.status === 400) { lastError = `${backend.name}: Bad request`; continue; }
        if (geminiRes.status === 404) { lastError = `${backend.name}: Model not found`; continue; }

        if (geminiRes.ok) {
          // Stream SSE back to client
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          
          const reader = geminiRes.body.getReader();
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
          
          return res.end();
        }

        lastError = `${backend.name}: HTTP ${geminiRes.status}`;

      } catch (err) {
        lastError = `${backend.name}: ${err.message}`;
      }
    }

    return res.status(502).json({ 
      error: { message: `All backends failed. Last error: ${lastError}` } 
    });

  } catch (err) {
    return res.status(500).json({ error: { message: err.message } });
  }
}
