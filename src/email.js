/**
 * email.js — Send license keys via SMTP
 * Supports QQ, Gmail, 163, or any SMTP provider.
 *
 * Configure in .env:
 *   SMTP_HOST=smtp.qq.com
 *   SMTP_PORT=465
 *   SMTP_SECURE=true
 *   SMTP_USER=you@qq.com
 *   SMTP_PASS=your_smtp_password    (QQ: 授权码, Gmail: app password)
 *   SMTP_FROM=you@qq.com
 */

const nodemailer = require('nodemailer');
const chalk = require('chalk');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT, 10) || 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.log(chalk.yellow('  SMTP not configured — email sending disabled.'));
    console.log(chalk.dim('  Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env'));
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE !== 'false',
    auth: { user, pass },
  });

  console.log(chalk.dim(`  SMTP ready: ${user} @ ${host}`));
  return transporter;
}

/**
 * Send a license key email to a customer.
 */
async function sendLicenseEmail(toEmail, licenseKey, expiryDate) {
  const transport = getTransporter();
  if (!transport) {
    console.log(chalk.yellow(`  Cannot email ${toEmail} — SMTP not configured`));
    return { sent: false, reason: 'SMTP not configured' };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  const html = `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#111b21;color:#e9edef;border-radius:12px;overflow:hidden;">
  <div style="background:#00a884;color:#111b21;padding:24px 28px;text-align:center;">
    <h1 style="margin:0;font-size:22px;">AI Sales Copilot Pro</h1>
    <p style="margin:6px 0 0;font-size:14px;opacity:.85;">Your license key is ready</p>
  </div>
  <div style="padding:28px;">
    <p style="font-size:15px;line-height:1.5;margin:0 0 20px;">
      Thank you for upgrading to <strong>AI Sales Copilot Pro</strong>!
      Here is your license information:
    </p>
    <div style="background:#202c33;border:1px solid #2a3942;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <p style="margin:0 0 10px;font-size:13px;color:#8696a0;">License Key</p>
      <p style="margin:0;font-size:18px;font-family:monospace;font-weight:700;color:#00a884;word-break:break-all;">${licenseKey}</p>
      <p style="margin:12px 0 0;font-size:13px;color:#8696a0;">
        Email: <strong style="color:#e9edef;">${toEmail}</strong><br>
        Expires: <strong style="color:#e9edef;">${expiryDate}</strong>
      </p>
    </div>
    <p style="font-size:14px;line-height:1.5;margin:0 0 8px;color:#8696a0;">
      <strong>How to activate:</strong>
    </p>
    <ol style="font-size:13px;color:#8696a0;line-height:1.8;padding-left:20px;margin:0 0 20px;">
      <li>Open WhatsApp Web and click the AI Sales Copilot extension icon</li>
      <li>Go to the <strong style="color:#e9edef;">Pro</strong> tab</li>
      <li>Enter your email and the license key above</li>
      <li>Click <strong style="color:#e9edef;">Activate Pro</strong></li>
    </ol>
    <p style="font-size:12px;color:#8696a0;margin:0;text-align:center;">
      Questions? Reply to this email or contact support.<br>
      Thank you for your support! 🚀
    </p>
  </div>
</div>`;

  try {
    const info = await transport.sendMail({
      from: `"AI Sales Copilot" <${from}>`,
      to: toEmail,
      subject: '🎉 Your AI Sales Copilot Pro License Key',
      html,
    });
    console.log(chalk.green(`  License email sent to ${toEmail}: ${info.messageId}`));
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error(chalk.red(`  Failed to email ${toEmail}: ${err.message}`));
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendLicenseEmail, getTransporter };
