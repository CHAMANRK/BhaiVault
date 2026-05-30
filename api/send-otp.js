// api/send-otp.js
// TextBee ke zariye real SMS OTP bhejta hai
// Env vars: TEXTBEE_API_KEY, TEXTBEE_DEVICE_ID, FIREBASE_DB_URL

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  const { phone } = req.body;

  // Validate
  if (!phone || !/^\d{10}$/.test(phone))
    return res.status(400).json({ error: '10 digit phone number chahiye' });

  const fullPhone = '+91' + phone;

  try {
    // 1. Random 6-digit OTP banao
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = Date.now() + 5 * 60 * 1000; // 5 minutes

    // 2. RTDB mein store karo (REST API)
    const dbUrl = process.env.FIREBASE_DB_URL;
    const dbKey = phone; // phone number as key

    const dbRes = await fetch(`${dbUrl}/otp_store/${dbKey}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp, expiry, attempts: 0 })
    });

    if (!dbRes.ok) {
      const err = await dbRes.text();
      throw new Error('DB store failed: ' + err);
    }

    // 3. TextBee se SMS bhejo
    const smsRes = await fetch(
      `https://api.textbee.dev/api/v1/gateway/devices/${process.env.TEXTBEE_DEVICE_ID}/send-sms`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.TEXTBEE_API_KEY
        },
        body: JSON.stringify({
          recipients: [fullPhone],
          message: `BhaiChara OTP: ${otp}\n\nYe OTP 5 minute mein expire ho jaayega. Kisi ke saath share mat karna! 🔒`
        })
      }
    );

    if (!smsRes.ok) {
      const err = await smsRes.text();
      throw new Error('SMS send failed: ' + err);
    }

    // Success — OTP mat bhejo response mein!
    return res.status(200).json({ success: true, message: 'OTP bhej diya!' });

  } catch (err) {
    console.error('send-otp error:', err);
    return res.status(500).json({ error: err.message });
  }
}
