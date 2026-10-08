const apiKey = process.env.BREVO_API_KEY;
const fromEmail = process.env.MAIL_FROM_EMAIL;
const fromName = process.env.MAIL_FROM_NAME || 'Chat App';

if (apiKey) {
  console.log('Email ready: sending via Brevo from ' + fromEmail);
} else {
  console.log('No BREVO_API_KEY in .env: emails will be printed here instead of sent.');
}

module.exports = async (to, subject, text, html) => {
  if (!apiKey) return console.log(`\n[DEV MAIL] To: ${to}\nSubject: ${subject}\n${text}\n`);

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html || `<p>${text.replace(/\n/g, '<br>')}</p>`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brevo error ${res.status}: ${body}`);
  }
};