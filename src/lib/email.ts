import nodemailer from 'nodemailer';

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!process.env.SMTP_HOST) return null;
  if (_transporter) return _transporter;

  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return _transporter;
}

export function isEmailConfigured(): boolean {
  return !!process.env.SMTP_HOST;
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<{ success: boolean }> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[Email] SMTP_HOST not configured — email sending skipped.');
    return { success: true };
  }

  try {
    const from = process.env.SMTP_FROM || 'noreply@fovi.ai';
    await transporter.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    return { success: true };
  } catch (err) {
    console.warn('[Email] Failed to send email:', err instanceof Error ? err.message : err);
    return { success: true }; // Don't expose email failures to the user
  }
}
