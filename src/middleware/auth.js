/**
 * Auth Middleware - Verifies Supabase JWT tokens
 */
const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../services/supabase');

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get business from database
    const { data: business, error } = await supabaseAdmin
      .from('businesses')
      .select('*')
      .eq('email', decoded.email)
      .single();

    if (error || !business) {
      return res.status(401).json({ error: 'Business not found' });
    }

    req.user = decoded;
    req.business = business;
    req.businessId = business.id;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = authMiddleware;
