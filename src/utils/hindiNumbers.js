/**
 * Utility to convert numbers and dates into natural Hinglish/Hindi speech strings.
 * Example: 85000 -> "pachaasi hazaar"
 */

const hindiNumbers = {
  0: 'shunya', 1: 'ek', 2: 'do', 3: 'teen', 4: 'chaar', 5: 'paanch', 6: 'chhay', 7: 'saat', 8: 'aath', 9: 'nau', 10: 'dus',
  11: 'gyaarah', 12: 'baarah', 13: 'teerah', 14: 'chaudah', 15: 'pandrah', 16: 'solah', 17: 'sattrah', 18: 'athrah', 19: 'unnees', 20: 'bees',
  25: 'pachis', 30: 'tees', 40: 'chaalees', 50: 'pachaas', 60: 'saath', 70: 'sattar', 80: 'assee', 90: 'nabbe', 100: 'sau'
};

function numberToHindi(num) {
  num = parseInt(num);
  if (isNaN(num)) return "aapka payment";

  if (num === 0) return "shunya";
  
  let result = "";

  if (num >= 10000000) {
    result += numberToHindi(Math.floor(num / 10000000)) + " crore ";
    num %= 10000000;
  }

  if (num >= 100000) {
    result += numberToHindi(Math.floor(num / 100000)) + " lakh ";
    num %= 100000;
  }

  if (num >= 1000) {
    result += numberToHindi(Math.floor(num / 1000)) + " hazaar ";
    num %= 1000;
  }

  if (num >= 100) {
    result += numberToHindi(Math.floor(num / 100)) + " sau ";
    num %= 100;
  }

  if (num > 0) {
    if (hindiNumbers[num]) {
      result += hindiNumbers[num];
    } else {
      result += num.toString(); // Fallback to digits for complex small numbers
    }
  }

  return result.trim();
}

/**
 * Formats amount into a natural speaking sentence.
 * 85000 -> "pachaasi hazaar rupaye"
 */
function formatAmountForSpeech(amount) {
  const hindiStr = numberToHindi(amount);
  return `${hindiStr} rupaye`;
}

module.exports = { numberToHindi, formatAmountForSpeech };
