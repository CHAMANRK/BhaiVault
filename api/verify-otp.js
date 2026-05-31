// api/verify-otp.js
// RTDB se OTP compare karta hai + expiry check karta hai (WITH DEBUGGER)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ error: 'Phone aur OTP dono chahiye' });

  try {
    // URL me se space ya trailing slash hatane ka double check
    const dbUrl = process.env.FIREBASE_DB_URL.trim().replace(/\/$/, '');

    // Fetch from Firebase
    const fetchUrl = `${dbUrl}/otp_store/${phone}.json`;
    const dbRes = await fetch(fetchUrl, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    
    const dbStatus = dbRes.status;
    const data = await dbRes.json();

    // 🔥 DEBUGGER: Agar OTP nahi mila, toh exact reason screen par dikha
    if (!data || !data.otp) {
      return res.status(400).json({ 
        error: `DEBUG -> Status: ${dbStatus} | Data: ${JSON.stringify(data)} | Phone: ${phone}` 
      });
    }

    // Expire ho gaya?
    if (Date.now() > data.expiry) {
      await fetch(fetchUrl, { method: 'DELETE' });
      return res.status(400).json({ error: 'OTP expire ho gaya! Dobara mangao.' });
    }

    // Attempts check (max 5)
    if (data.attempts >= 5) {
      await fetch(fetchUrl, { method: 'DELETE' });
      return res.status(400).json({ error: 'Zyada galat tries! Naya OTP mangao.' });
    }

    // OTP match karo
    if (data.otp !== otp.trim()) {
      await fetch(fetchUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attempts: (data.attempts || 0) + 1 })
      });
      const remaining = 4 - (data.attempts || 0);
      return res.status(400).json({ error: `Galat OTP! ${remaining} tries baaki hain.` });
    }

    // ✅ OTP sahi hai — delete karo (one-time use)
    await fetch(fetchUrl, { method: 'DELETE' });

    return res.status(200).json({ success: true, message: 'OTP verified!' });

  } catch (err) {
    console.error('verify-otp error:', err);
    return res.status(500).json({ error: `Server Error: ${err.message}` });
  }
}
