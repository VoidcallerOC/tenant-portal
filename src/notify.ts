type Message = { toEmail?: string | null; toPhone?: string | null; subject: string; body: string };

export async function notify(message: Message) {
  const tasks = [];
  if (message.toEmail) tasks.push(sendEmail(message.toEmail, message.subject, message.body));
  if (message.toPhone) tasks.push(sendSms(message.toPhone, `${message.subject}: ${message.body}`));
  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === 'rejected') console.error('Notification failed', result.reason);
  }
}

async function sendEmail(to: string, subject: string, body: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM_EMAIL || 'portal@localhost';
  if (!key) {
    console.log('[notify:email] to=' + to + ' subject=' + subject + ' body=' + body);
    return;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, text: body }),
  });
  if (!response.ok) throw new Error('Resend ' + response.status + ': ' + await response.text());
}

async function sendSms(to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    console.log('[notify:sms] to=' + to + ' body=' + body);
    return;
  }
  const params = new URLSearchParams({ To: to, From: from, Body: body.slice(0, 1400) });
  const response = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  if (!response.ok) throw new Error('Twilio ' + response.status + ': ' + await response.text());
}
