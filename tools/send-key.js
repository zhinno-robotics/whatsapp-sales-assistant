/**
 * send-key.js — Generate license key + email it to customer
 * Usage: node tools/send-key.js <email> <days>
 * Example: node tools/send-key.js buyer@gmail.com 30
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { generateLicenseKey } = require('../src/license');
const { sendLicenseEmail } = require('../src/email');

async function main() {
  const email = process.argv[2];
  const days = parseInt(process.argv[3], 10) || 30;

  if (!email || !email.includes('@')) {
    console.error('Usage: node tools/send-key.js <email> <days>');
    console.error('Example: node tools/send-key.js buyer@gmail.com 30');
    process.exit(1);
  }

  console.log(`\nGenerating ${days}-day license for ${email}...`);

  const license = generateLicenseKey(email, days);
  console.log(`  Key:     ${license.key}`);
  console.log(`  Expires: ${license.expiryDate}`);

  console.log(`\nSending email to ${email}...`);
  const result = await sendLicenseEmail(email, license.key, license.expiryDate);

  if (result.sent) {
    console.log(`✅ License key sent to ${email}!\n`);
  } else {
    console.log(`❌ Email failed: ${result.reason}`);
    console.log(`   Key: ${license.key}`);
    console.log(`   Manually send this key to ${email}\n`);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
