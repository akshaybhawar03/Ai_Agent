/**
 * Calls Routes - Initiate calls, get logs
 */
const express = require('express');
const { supabaseAdmin } = require('../services/supabase');
const { initiateCall, bulkCall } = require('../services/callEngine');

const router = express.Router();

// POST /api/calls/single/:customerId - Initiate a single call
router.post('/single/:customerId', async (req, res) => {
  try {
    const result = await initiateCall(req.params.customerId, req.businessId);
    res.json(result);
  } catch (error) {
    console.error('Single call error:', error);
    let msg = error.message;
    if (error.code === 21219) {
      msg = 'Twilio trial account: You must verify this number at twilio.com/console/phone-numbers/verified before calling it.';
    }
    res.status(400).json({ error: msg });
  }
});

// POST /api/calls/bulk - Bulk call all pending customers
router.post('/bulk', async (req, res) => {
  try {
    const result = await bulkCall(req.businessId);
    res.json(result);
  } catch (error) {
    console.error('Bulk call error:', error);
    res.status(400).json({ error: error.message });
  }
});

// GET /api/calls/logs - Get call logs
router.get('/logs', async (req, res) => {
  try {
    const { status, search, start_date, end_date, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('call_logs')
      .select('*', { count: 'exact' })
      .eq('business_id', req.businessId)
      .order('called_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (search) {
      query = query.or(`customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%`);
    }

    if (start_date) {
      query = query.gte('called_at', start_date);
    }

    if (end_date) {
      query = query.lte('called_at', end_date);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    res.json({
      logs: data,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit)
    });
  } catch (error) {
    console.error('Get call logs error:', error);
    res.status(500).json({ error: 'Failed to fetch call logs' });
  }
});

// GET /api/calls/logs/:id - Get a single call log with details
router.get('/logs/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('call_logs')
      .select('*')
      .eq('id', req.params.id)
      .eq('business_id', req.businessId)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Call log not found' });

    res.json(data);
  } catch (error) {
    console.error('Get call log error:', error);
    res.status(500).json({ error: 'Failed to fetch call log' });
  }
});

module.exports = router;
