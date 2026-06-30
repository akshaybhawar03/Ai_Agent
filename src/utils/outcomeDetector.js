/**
 * Outcome Detector - Analyzes call transcripts using GPT
 * Now supports multiple use cases with dynamic outcome categories
 */
const { getOpenAIClient, getModelName } = require('../services/openai');
const { USE_CASES } = require('./useCaseTemplates');

async function detectOutcome(transcript, apiKey, useCase = 'payment_recovery') {
  const client = getOpenAIClient(apiKey);
  const template = USE_CASES[useCase] || USE_CASES.payment_recovery;

  try {
    const res = await client.chat.completions.create({
      model: getModelName(),
      messages: [
        {
          role: 'system',
          content: 'Analyze call transcript. Return only valid JSON. No markdown, no code blocks.'
        },
        {
          role: 'user',
          content: `Transcript: "${transcript}"\n\n${template.outcomePrompt}`
        }
      ],
      max_tokens: 150,
      temperature: 0.1
    });

    const content = res.choices[0].message.content.trim();
    // Try to extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(content);
  } catch (error) {
    console.error('Outcome detection failed:', error.message);
    return {
      outcome: 'no_answer',
      promise_date: null,
      amount_promised: null,
      summary: 'Outcome detect nahi ho paya'
    };
  }
}

function mapOutcomeToStatus(outcome) {
  const map = {
    // Payment Recovery
    'promise_given': 'promised',
    'paid': 'paid',
    'refused': 'refused',
    'callback': 'callback',
    'no_answer': 'no_answer',
    'wrong_number': 'wrong_number',
    // Lead Generation
    'interested': 'interested',
    'not_interested': 'not_interested',
    'meeting_booked': 'meeting_booked',
    // Marketing
    'purchased': 'purchased',
    // Appointment
    'confirmed': 'confirmed',
    'rescheduled': 'rescheduled',
    'cancelled': 'cancelled',
    // Feedback
    'positive_feedback': 'positive',
    'negative_feedback': 'negative',
    'neutral': 'neutral',
    // Custom
    'success': 'success',
    'failed': 'failed'
  };
  return map[outcome] || 'pending';
}

module.exports = { detectOutcome, mapOutcomeToStatus };
