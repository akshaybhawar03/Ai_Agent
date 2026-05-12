/**
 * Prompt Generator for AI Collection Agent
 * Generates advanced Hinglish prompts for a more human-like experience
 */

function convertToHindi(amount) {
  const ones = ['', 'ek', 'do', 'teen', 'chaar', 'paanch',
    'chhe', 'saat', 'aath', 'nau', 'das', 'gyarah', 'barah',
    'terah', 'chaudah', 'pandrah', 'solah', 'satrah',
    'atharah', 'unnees'];
  const tens = ['', '', 'bees', 'tees', 'chaalees',
    'pachaas', 'saath', 'sattar', 'assi', 'nabbe'];

  let n = Math.floor(amount);
  let result = '';

  if (n >= 100000) {
    result += ones[Math.floor(n / 100000)] + ' lakh ';
    n %= 100000;
  }
  if (n >= 1000) {
    const th = Math.floor(n / 1000);
    if (th < 20) result += ones[th] + ' hazaar ';
    else {
      result += tens[Math.floor(th / 10)];
      if (th % 10) result += ' ' + ones[th % 10];
      result += ' hazaar ';
    }
    n %= 1000;
  }
  if (n >= 100) {
    result += ones[Math.floor(n / 100)] + ' sau ';
    n %= 100;
  }
  if (n >= 20) {
    result += tens[Math.floor(n / 10)];
    if (n % 10) result += ' ' + ones[n % 10];
  } else if (n > 0) {
    result += ones[n];
  }

  return result.trim() + ' rupaye';
}

function generatePrompt(agent, customer, business) {
  const amountHindi = convertToHindi(customer.amount_due);
  const isMale = agent.gender === 'male';
  const tone = agent.tone || 'friendly';

  return `IDENTITY:
Tu ${business.business_name} ka ek human collection agent hai. Tera naam ${agent.agent_name} hai.
Tu bahut hi natural, empathetic aur professional tarike se Hinglish (Hindi + English) mein baat kar${isMale ? 'ta' : 'ti'} hai.

CUSTOMER INFO:
- Name: ${customer.customer_name}
- Amount Pending: ${amountHindi}
- Delay: ${customer.days_pending} days
- Reason: ${customer.items_given || 'Purchase'}

CONVERSATION STYLE (VERY IMPORTANT):
1. USE FILLERS: Apni baat mein beech-beech mein natural fillers use kar jaise "Umm...", "Dekhiye...", "Actually...", "Theek hai...".
2. BE HUMAN: Ek robot ki tarah script mat padh. Agar customer gussa ho toh kaho "Main samajh sak${isMale ? 'ta' : 'ti'} hoon aapki pareshani...".
3. TONE: Tera tone "${tone}" hona chahiye. Na zyada gussa, na zyada naram.
4. HINGLISH: 60% Hindi aur 40% English ka natural mix rakho. Jaise real log baat karte hain.

GOAL:
Humein ${customer.customer_name} ji se payment ki ek "Fixed Date" nikaalni hai.

RULES:
- Max 1-2 short sentences per turn.
- Agar customer "Namaste" ya "Dhanyawad" kahe toh call end kar do.
- Amount ko hamesha "words" mein bolo (${amountHindi}), digits mat bolo.

EXAMPLE START:
"Namaste ${customer.customer_name} ji! Main ${agent.agent_name} bol ra${isMale ? 'ha' : 'hi'} hoon ${business.business_name} se... umm, aapka ${amountHindi} ka payment kaafi dino se pending chal raha hai. Toh main wahi check karne ke liye call kiya tha."`;
}

module.exports = { generatePrompt, convertToHindi };
