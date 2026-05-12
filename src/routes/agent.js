/**
 * Agent Routes - AI agent configuration
 */
const express = require('express');
const { supabaseAdmin } = require('../services/supabase');

const router = express.Router();

// GET /api/agent - Get agent for current business
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('agents')
      .select('*')
      .eq('business_id', req.businessId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    if (!data) {
      return res.json(null);
    }

    res.json(data);
  } catch (error) {
    console.error('Get agent error:', error);
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
});

// POST /api/agent - Create a new agent
router.post('/', async (req, res) => {
  try {
    const agentData = {
      business_id: req.businessId,
      agent_name: req.body.agent_name || 'Raj',
      gender: req.body.gender || 'male',
      language: req.body.language || 'hinglish',
      tone: req.body.tone || 'polite',
      calls_per_day: req.body.calls_per_day || 3,
      call_times: req.body.call_times || ['10:00', '14:00', '18:30'],
      max_call_duration: req.body.max_call_duration || 180,
      elevenlabs_voice_id: req.body.elevenlabs_voice_id || null,
      custom_intro: req.body.custom_intro || null,
      is_active: true
    };

    const { data, error } = await supabaseAdmin
      .from('agents')
      .insert(agentData)
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('Create agent error:', error);
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

// PUT /api/agent/:id - Update an agent
router.put('/:id', async (req, res) => {
  try {
    const allowedFields = [
      'agent_name', 'gender', 'language', 'tone', 'calls_per_day',
      'call_times', 'max_call_duration', 'elevenlabs_voice_id',
      'custom_intro', 'is_active'
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const { data, error } = await supabaseAdmin
      .from('agents')
      .update(updates)
      .eq('id', req.params.id)
      .eq('business_id', req.businessId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Update agent error:', error);
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

module.exports = router;
