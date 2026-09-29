const nodemailer = require('nodemailer');

const host = process.env.SMTP_HOST;
const user = process.env.SMTP_USER;
const pass = (process.env.SMTP_PASS || '').replace(/\s/g, ''); // Google shows the code with spaces
const port = Number(process.env.SMTP_PORT) || 587;

const transporter = host && user && pass
  ? nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
  : null;

if (transporter) {
  transporter.verify()
    .then(() => console.log('Email ready: sending from ' + user))
    .catch(e => console.error('EMAIL SETUP PROBLEM:', e.message));
} else {
  console.log('No email settings in .env: emails will be printed here instead of sent.');
}

module.exports = async (to, subject, text, html) => {
  if (!transporter) return console.log(`\n[DEV MAIL] To: ${to}\nSubject: ${subject}\n${text}\n`);
  await transporter.sendMail({ from: process.env.MAIL_FROM || user, to, subject, text, html });
};