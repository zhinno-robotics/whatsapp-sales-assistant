/**
 * generate-license.js — AI Sales Copilot Pro License Key Generator
 *
 * Usage: node tools/generate-license.js <email> <expiry_days_from_now>
 *
 * Example (30-day license):
 *   node tools/generate-license.js user@example.com 30
 *
 * Example (365-day license):
 *   node tools/generate-license.js user@example.com 365
 *
 * License key format: AISC-XXXX-XXXX-XXXX-XXXX
 * - 12 chars: HMAC-SHA256 signature (first 12 hex chars)
 * - 8 chars: expiry date as hex (days since epoch)
 * - N chars: email hex-encoded
 * Dashes added for readability every 4 chars.
 */

const crypto = require('crypto');

const SECRET = 'aisc-pro-secret-2026'; // Must match LICENSE_SECRET in background.js

function generateLicense(email, expiryDaysFromNow) {
  if (!email || !expiryDaysFromNow || expiryDaysFromNow <= 0) {
    console.error('Usage: node generate-license.js <email> <expiry_days_from_now>');
    console.error('Example: node generate-license.js user@example.com 30');
    process.exit(1);
  }

  // Expiry: days since epoch
  const nowDays = Math.floor(Date.now() / 86400000);
  const expiryDays = nowDays + parseInt(expiryDaysFromNow, 10);
  const expiryHex = expiryDays.toString(16).padStart(8, '0');

  // Email: hex-encoded
  const emailHex = Buffer.from(email.trim().toLowerCase()).toString('hex');

  // Signature: HMAC-SHA256(email:expiryHex) — first 12 hex chars
  const message = email.trim().toLowerCase() + ':' + expiryHex;
  const sig = crypto.createHmac('sha256', SECRET).update(message).digest('hex').substring(0, 12);

  // Build key: AISC + sig + expiryHex + emailHex
  const raw = 'AISC' + sig + expiryHex + emailHex;
  // Add dashes every 4 chars
  const key = raw.match(/.{1,4}/g).join('-');

  const expiryDate = new Date(expiryDays * 86400000);

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  AI Sales Copilot — Pro License Key');
  console.log('═══════════════════════════════════════════');
  console.log('');
  console.log('  Email:   ', email.trim().toLowerCase());
  console.log('  Expires: ', expiryDate.toISOString().split('T')[0]);
  console.log('  Key:     ', key);
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('');
  console.log('Send this key to the customer. They enter it in:');
  console.log('Extension Popup → Pro tab → License Key + Email → Activate');
  console.log('');

  return key;
}

const args = process.argv.slice(2);
generateLicense(args[0], args[1]);
