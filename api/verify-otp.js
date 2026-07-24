// api/verify-otp.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ error: 'Phone aur OTP dono chahiye' });

  try {
    const dbUrl = process.env.FIREBASE_DB_URL.trim().replace(/\/$/, '');
    const fetchUrl = `${dbUrl}/otp_store/${phone}.json`;
    
    // Fresh fetch without cache
    const dbRes = await fetch(fetchUrl, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' }
    });
    
    const data = await dbRes.json();

    if (!data || !data.otp) {
      return res.status(400).json({ error: 'Pehle OTP mangao!' });
    }

    if (Date.now() > data.expiry) {
      await fetch(fetchUrl, { method: 'DELETE' });
      return res.status(400).json({ error: 'OTP expire ho gaya! Dobara mangao.' });
    }

    if (data.attempts >= 5) {
      await fetch(fetchUrl, { method: 'DELETE' });
      return res.status(400).json({ error: 'Zyada galat tries! Naya OTP mangao.' });
    }

    // 🔥 FIX 1: Dono ko strictly String bana kar aur spaces hata kar compare karo
    if (String(data.otp).trim() !== String(otp).trim()) {
      
      // Attempts increment karo
      await fetch(fetchUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attempts: (data.attempts || 0) + 1 })
      });
      
      // 🔥 FIX 2: Debug error msg — Taki tujhe sachhai dikhe
      return res.status(400).json({ 
        error: `Galat OTP! Tune dala: [${otp}], Database me hai: [${data.otp}]` 
      });
    }

    // ✅ OTP ekdum sahi hai!
    await fetch(fetchUrl, { method: 'DELETE' });
    return res.status(200).json({ success: true, message: 'OTP verified!' });

  } catch (err) {
    console.error('verify-otp error:', err);
    return res.status(500).json({ error: `Server Error: ${err.message}` });
  }
}
