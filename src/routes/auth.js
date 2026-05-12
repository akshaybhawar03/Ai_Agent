/**
 * Auth Routes - Signup and Login
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const { supabaseAdmin, supabaseAnon } = require('../services/supabase');

const router = express.Router();

// POST /auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { email, password, business_name, owner_name, phone, business_type } = req.body;

    if (!email || !password || !business_name) {
      return res.status(400).json({ error: 'Email, password, and business name are required' });
    }

    // Create Supabase auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    // Create business record
    const { data: business, error: bizError } = await supabaseAdmin
      .from('businesses')
      .insert({
        email,
        business_name,
        owner_name: owner_name || '',
        phone: phone || '',
        business_type: business_type || 'general'
      })
      .select()
      .single();

    if (bizError) {
      // Rollback auth user if business creation fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return res.status(400).json({ error: bizError.message });
    }

    // Create default agent for the business
    await supabaseAdmin.from('agents').insert({
      business_id: business.id,
      agent_name: 'Raj',
      gender: 'male',
      language: 'hinglish',
      tone: 'polite',
      calls_per_day: 3,
      call_times: ['10:00', '14:00', '18:30'],
      max_call_duration: 180
    });

    // Generate JWT
    const token = jwt.sign(
      { userId: authData.user.id, email, businessId: business.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: { email, businessId: business.id },
      business
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Authenticate with Supabase
    const { data: authData, error: authError } = await supabaseAnon.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get business record
    const { data: business, error: bizError } = await supabaseAdmin
      .from('businesses')
      .select('*')
      .eq('email', email)
      .single();

    if (bizError || !business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: authData.user.id, email, businessId: business.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { email, businessId: business.id },
      business
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
