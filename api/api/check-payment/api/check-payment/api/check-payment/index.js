// Endpoint Vercel: GET /api/check-payment?payment_id=123 OR ?external_reference=abc
const ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const API_BASE = 'https://api.mercadopago.com';

module.exports = async (req, res) => {
  if (!ACCESS_TOKEN) {
    return res.status(500).json({ error: 'MERCADOPAGO_ACCESS_TOKEN is not configured' });
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { payment_id, external_reference } = req.query;

    if (payment_id) {
      // Buscar pagamento por ID
      const mpRes = await fetch(`${API_BASE}/v1/payments/${encodeURIComponent(payment_id)}`, {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`
        }
      });
      const data = await mpRes.json();
      if (!mpRes.ok) {
        return res.status(mpRes.status).json({ error: data });
      }
      return res.status(200).json(data);
    }

    if (external_reference) {
      // Buscar por external_reference
      const mpRes = await fetch(`${API_BASE}/v1/payments/search?external_reference=${encodeURIComponent(external_reference)}`, {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`
        }
      });
      const data = await mpRes.json();
      if (!mpRes.ok) {
        return res.status(mpRes.status).json({ error: data });
      }
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: 'payment_id or external_reference query parameter is required' });

  } catch (error) {
    console.error('check-payment error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
