/**
 * License key generation & validation
 * Key format: AISC-{sig12}{expiry8}{emailHex} (dashes every 4 chars)
 * Signature: first 12 chars of SHA-256(secret + ':' + email + ':' + expiryHex)
 * Must match extension's background.js validateLicenseKey.
 */

const crypto = require('crypto');

// Must match LICENSE_SECRET in extension's background.js
const SECRET = process.env.LICENSE_SECRET || 'aisc-pro-secret-2026';

/**
 * Generate a Pro license key for a given email and duration.
 * @param {string} email - customer email
 * @param {number} daysFromNow - validity in days (e.g. 30, 365)
 * @returns {{ key: string, expiryDate: string, email: string }}
 */
function generateLicenseKey(email, daysFromNow = 30) {
  if (!email || daysFromNow <= 0) {
    throw new Error('Email and positive daysFromNow are required.');
  }

  const emailLower = email.trim().toLowerCase();
  const nowDays = Math.floor(Date.now() / 86400000);
  const expiryDays = nowDays + parseInt(daysFromNow, 10);
  const expiryHex = expiryDays.toString(16).padStart(8, '0');
  const emailHex = Buffer.from(emailLower).toString('hex');

  // Signature: first 12 chars of SHA-256(secret + ':' + email + ':' + expiryHex)
  const sigInput = SECRET + ':' + emailLower + ':' + expiryHex;
  const sig = crypto.createHash('sha256').update(sigInput).digest('hex').substring(0, 12);

  // Build key: AISC + sig(12) + expiry(8) + emailHex(rest)
  const raw = 'AISC' + sig + expiryHex + emailHex;
  const key = raw.match(/.{1,4}/g).join('-');

  const expiryDate = new Date(expiryDays * 86400000);

  return {
    key,
    email: emailLower,
    expiryDate: expiryDate.toISOString().split('T')[0],
    expiryDays,
  };
}

/**
 * Legacy: validate license key against phone number (for old Node.js server users).
 */
function generateLegacyKey(phoneNumber) {
  return crypto
    .createHmac('sha256', SECRET)
    .update(phoneNumber.trim())
    .digest('hex')
    .substring(0, 16)
    .toUpperCase();
}

function validateLegacyLicense(phoneNumber, licenseKey) {
  const expected = generateLegacyKey(phoneNumber);
  return expected === licenseKey.toUpperCase();
}

module.exports = { generateLicenseKey, generateLegacyKey, validateLegacyLicense };
