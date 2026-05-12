const OpenAI = require('openai');

let defaultClient = null;

/**
 * Get an AI client - supports OpenAI and Groq (free)
 * If GROQ_API_KEY is set, uses Groq's free API (OpenAI-compatible)
 * Otherwise falls back to OpenAI
 */
function getOpenAIClient(apiKey) {
  // Prefer Groq (free tier) if available
  if (process.env.GROQ_API_KEY) {
    return new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }
  return new OpenAI({ apiKey: apiKey || process.env.OPENAI_API_KEY });
}

function getDefaultClient() {
  if (!defaultClient) {
    if (process.env.GROQ_API_KEY) {
      defaultClient = new OpenAI({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1',
      });
    } else {
      defaultClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }
  return defaultClient;
}

/**
 * Get the appropriate model name based on which provider is being used
 */
function getModelName() {
  if (process.env.GROQ_API_KEY) {
    return 'llama-3.3-70b-versatile'; // Free on Groq, very capable
  }
  return 'gpt-4o-mini';
}

module.exports = { getOpenAIClient, getDefaultClient, getModelName };
