/**
 * License Key Generator
 * Usage: node gen-key.js <phone-number>
 * Example: node gen-key.js 8613800138000
 */
const { generateKey } = require('./src/license');

const phone = process.argv[2];

if (!phone) {
  console.log('Usage: node gen-key.js <phone-number>');
  console.log('Example: node gen-key.js 8613800138000');
  process.exit(1);
}

const key = generateKey(phone.trim());
console.log('');
console.log('  Phone Number: ' + phone);
console.log('  License Key:  ' + key);
console.log('');
console.log('  Give this key to the user. They enter it in setup.bat');
console.log('');
