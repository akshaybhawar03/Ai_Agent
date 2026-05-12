const express = require('express');
const { supabaseAdmin } = require('../services/supabase');
const router = express.Router();

router.get('/dashboard', async (req, res) => {
  try {
    const bid = req.businessId;
    const { count: totalCustomers } = await supabaseAdmin.from('customers').select('*', { count: 'exact', head: true }).eq('business_id', bid);
    const { data: pendingData } = await supabaseAdmin.from('customers').select('amount_due').eq('business_id', bid).in('status', ['pending', 'promised', 'callback', 'no_answer']);
    const pendingAmount = pendingData?.reduce((s, c) => s + parseFloat(c.amount_due || 0), 0) || 0;
    const { data: recoveredData } = await supabaseAdmin.from('customers').select('amount_due').eq('business_id', bid).eq('status', 'paid');
    const recoveredAmount = recoveredData?.reduce((s, c) => s + parseFloat(c.amount_due || 0), 0) || 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { count: callsToday } = await supabaseAdmin.from('call_logs').select('*', { count: 'exact', head: true }).eq('business_id', bid).gte('called_at', today.toISOString());
    const { data: recentCalls } = await supabaseAdmin.from('call_logs').select('*').eq('business_id', bid).order('called_at', { ascending: false }).limit(10);
    const { data: schedule } = await supabaseAdmin.from('customers').select('id, customer_name, phone, amount_due, status, call_count_today').eq('business_id', bid).in('status', ['pending', 'callback', 'promised']).lt('call_count_today', 3).order('days_pending', { ascending: false }).limit(10);
    res.json({ totalCustomers: totalCustomers || 0, pendingAmount, recoveredAmount, callsToday: callsToday || 0, recentCalls: recentCalls || [], schedule: schedule || [] });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

module.exports = router;
