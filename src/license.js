/**
 * Simple license validation for commercialization
 * License key = HMAC of the WhatsApp phone number
 */
const crypto = require('crypto');

const SECRET = 'wasap-ai-sales-2026'; // Change this for production

/**
 * Generate a license key for a given phone number
 */
function generateKey(phoneNumber) {
  return crypto
    .createHmac('sha256', SECRET)
    .update(phoneNumber.trim())
    .digest('hex')
    .substring(0, 16)
    .toUpperCase();
}

/**
 * Validate license key against phone number
 */
function validateLicense(phoneNumber, licenseKey) {
  const expected = generateKey(phoneNumber);
  return expected === licenseKey.toUpperCase();
}

module.exports = { generateKey, validateLicense };
