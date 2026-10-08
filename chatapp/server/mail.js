const SibApiV3Sdk = require('@getbrevo/brevo');

const apiKey = process.env.BREVO_API_KEY;
const fromEmail = process.env.MAIL_FROM_EMAIL;
const fromName = process.env.MAIL_FROM_NAME || 'Chat App';

let client = null;
if (apiKey) {
  client = new SibApiV3Sdk.TransactionalEmailsApi();
  client.setApiKey(SibApiV3Sdk.TransactionalEmailsApiApiKeys.apiKey, apiKey);
  console.log('Email ready: sending via Brevo from ' + fromEmail);
} else {
  console.log('No BREVO_API_KEY in .env: emails will be printed here instead of sent.');
}

module.exports = async (to, subject, text, html) => {
  if (!client) return console.log(`\n[DEV MAIL] To: ${to}\nSubject: ${subject}\n${text}\n`);
  const email = new SibApiV3Sdk.SendSmtpEmail();
  email.sender = { email: fromEmail, name: fromName };
  email.to = [{ email: to }];
  email.subject = subject;
  email.textContent = text;
  email.htmlContent = html || `<p>${text.replace(/\n/g, '<br>')}</p>`;
  await client.sendTransacEmail(email);
};