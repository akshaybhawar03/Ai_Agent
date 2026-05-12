/**
 * Outcome Detector - Analyzes call transcripts using GPT
 */
const { getOpenAIClient, getModelName } = require('../services/openai');

async function detectOutcome(transcript, apiKey) {
  const client = getOpenAIClient(apiKey);

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
          content: `Transcript: "${transcript}"
      
Return JSON:
{
  "outcome": "promise_given|paid|refused|callback|no_answer|wrong_number",
  "promise_date": "YYYY-MM-DD or null",
  "amount_promised": number_or_null,
  "summary": "1 line Hindi mein"
}`
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
    'promise_given': 'promised',
    'paid': 'paid',
    'refused': 'refused',
    'callback': 'callback',
    'no_answer': 'no_answer',
    'wrong_number': 'wrong_number'
  };
  return map[outcome] || 'pending';
}

module.exports = { detectOutcome, mapOutcomeToStatus };
