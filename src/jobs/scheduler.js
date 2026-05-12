/**
 * Scheduled Jobs - Automated calling and daily resets
 */
const cron = require('node-cron');
const { supabaseAdmin } = require('../services/supabase');
const { bulkCall } = require('../services/callEngine');

async function callAllPending() {
  console.log(`[Scheduler] Running bulk calls at ${new Date().toISOString()}`);

  try {
    // Get all active businesses
    const { data: businesses } = await supabaseAdmin
      .from('businesses')
      .select('id, business_name')
      .eq('is_active', true);

    if (!businesses || businesses.length === 0) {
      console.log('[Scheduler] No active businesses found');
      return;
    }

    for (const business of businesses) {
      try {
        console.log(`[Scheduler] Calling pending customers for ${business.business_name}`);
        const result = await bulkCall(business.id);
        console.log(`[Scheduler] ${business.business_name}: Called ${result.called}/${result.total}`);
      } catch (error) {
        console.error(`[Scheduler] Error for ${business.business_name}:`, error.message);
      }
    }
  } catch (error) {
    console.error('[Scheduler] Bulk call job failed:', error.message);
  }
}

async function resetDailyCounts() {
  console.log(`[Scheduler] Resetting daily call counts at ${new Date().toISOString()}`);

  try {
    await supabaseAdmin
      .from('customers')
      .update({ call_count_today: 0 })
      .neq('call_count_today', 0);

    console.log('[Scheduler] Daily counts reset successfully');
  } catch (error) {
    console.error('[Scheduler] Reset failed:', error.message);
  }
}

function initScheduler() {
  // 10 AM IST
  cron.schedule('0 10 * * *', callAllPending, { timezone: 'Asia/Kolkata' });

  // 2 PM IST
  cron.schedule('0 14 * * *', callAllPending, { timezone: 'Asia/Kolkata' });

  // 6:30 PM IST
  cron.schedule('30 18 * * *', callAllPending, { timezone: 'Asia/Kolkata' });

  // Reset at midnight IST
  cron.schedule('59 23 * * *', resetDailyCounts, { timezone: 'Asia/Kolkata' });

  console.log('[Scheduler] Cron jobs initialized (IST: 10:00, 14:00, 18:30, 23:59)');
}

module.exports = { initScheduler, callAllPending, resetDailyCounts };
