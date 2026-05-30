// api/verify-otp.js
// RTDB se OTP compare karta hai + expiry check karta hai
// Env vars: FIREBASE_DB_URL

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  const { phone, otp } = req.body;

  if (!phone || !otp)
    return res.status(400).json({ error: 'Phone aur OTP dono chahiye' });

  try {
    const dbUrl = process.env.FIREBASE_DB_URL.replace(/\/$/, ''); // trailing slash hatao

    // RTDB se stored OTP lo
    const dbRes = await fetch(`${dbUrl}/otp_store/${phone}.json`);
    const data = await dbRes.json();

    // OTP exist karta hai?
    if (!data || !data.otp)
      return res.status(400).json({ error: 'Pehle OTP mangao!' });

    // Expire ho gaya?
    if (Date.now() > data.expiry) {
      // Expired OTP delete karo
      await fetch(`${dbUrl}/otp_store/${phone}.json`, { method: 'DELETE' });
      return res.status(400).json({ error: 'OTP expire ho gaya! Dobara mangao.' });
    }

    // Attempts check (max 5)
    if (data.attempts >= 5) {
      await fetch(`${dbUrl}/otp_store/${phone}.json`, { method: 'DELETE' });
      return res.status(400).json({ error: 'Zyada galat tries! Naya OTP mangao.' });
    }

    // OTP match karo
    if (data.otp !== otp.trim()) {
      // Attempts increment karo
      await fetch(`${dbUrl}/otp_store/${phone}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attempts: (data.attempts || 0) + 1 })
      });
      const remaining = 4 - (data.attempts || 0);
      return res.status(400).json({ error: `Galat OTP! ${remaining} tries baaki hain.` });
    }

    // ✅ OTP sahi hai — delete karo (one-time use)
    await fetch(`${dbUrl}/otp_store/${phone}.json`, { method: 'DELETE' });

    return res.status(200).json({ success: true, message: 'OTP verified!' });

  } catch (err) {
    console.error('verify-otp error:', err);
    return res.status(500).json({ error: err.message });
  }
}
