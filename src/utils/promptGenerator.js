/**
 * Prompt Generator - Re-exports from Use Case Templates
 * Maintains backward compatibility while delegating to the new template system
 */
const { generateUseCasePrompt, USE_CASES } = require('./useCaseTemplates');

function convertToHindi(amount) {
  const ones = ['', 'ek', 'do', 'teen', 'chaar', 'paanch',
    'chhe', 'saat', 'aath', 'nau', 'das', 'gyarah', 'barah',
    'terah', 'chaudah', 'pandrah', 'solah', 'satrah', 'atharah', 'unnees'];
  const tens = ['', '', 'bees', 'tees', 'chaalees',
    'pachaas', 'saath', 'sattar', 'assi', 'nabbe'];
  let n = Math.floor(amount);
  let result = '';
  if (n >= 100000) { result += ones[Math.floor(n/100000)] + ' lakh '; n %= 100000; }
  if (n >= 1000) {
    const th = Math.floor(n/1000);
    if (th < 20) result += ones[th] + ' hazaar ';
    else { result += tens[Math.floor(th/10)]; if(th%10) result += ' ' + ones[th%10]; result += ' hazaar '; }
    n %= 1000;
  }
  if (n >= 100) { result += ones[Math.floor(n/100)] + ' sau '; n %= 100; }
  if (n >= 20) { result += tens[Math.floor(n/10)]; if(n%10) result += ' ' + ones[n%10]; }
  else if (n > 0) { result += ones[n]; }
  return result.trim() + ' rupaye';
}

// Use the new template-based prompt generator
function generatePrompt(agent, customer, business) {
  return generateUseCasePrompt(agent, customer, business);
}

module.exports = { generatePrompt, convertToHindi, USE_CASES };
