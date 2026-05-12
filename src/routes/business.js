/**
 * Business Routes - Profile and settings management
 */
const express = require('express');
const { supabaseAdmin } = require('../services/supabase');

const router = express.Router();

// GET /api/business - Get current business profile
router.get('/', async (req, res) => {
  try {
    res.json(req.business);
  } catch (error) {
    console.error('Get business error:', error);
    res.status(500).json({ error: 'Failed to fetch business' });
  }
});

// PUT /api/business - Update business profile
router.put('/', async (req, res) => {
  try {
    const allowedFields = [
      'business_name', 'owner_name', 'business_type', 'phone',
      'twilio_account_sid', 'twilio_auth_token', 'twilio_phone_number',
      'elevenlabs_api_key', 'openai_api_key', 'deepgram_api_key'
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabaseAdmin
      .from('businesses')
      .update(updates)
      .eq('id', req.businessId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Update business error:', error);
    res.status(500).json({ error: 'Failed to update business' });
  }
});

module.exports = router;
