/**
 * Email Tools - ابزارهای مدیریت ایمیل
 * 
 * پشتیبانی از Gmail با IMAP + SMTP
 * برای Gmail باید App Password بسازی:
 * https://myaccount.google.com/apppasswords
 */

const nodemailer = require('nodemailer');
const { log } = require('../database/db');

// ─────────────────────────────────────────
// SMTP Transporter (ارسال ایمیل)
// ─────────────────────────────────────────
let smtpTransporter = null;

function getSmtpTransporter() {
    if (!smtpTransporter) {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
            throw new Error('ایمیل تنظیم نشده. EMAIL_USER و EMAIL_PASSWORD را در .env تنظیم کنید.');
        }
        const emailPassword = (process.env.EMAIL_PASSWORD || '').replace(/\s+/g, '');
        smtpTransporter = nodemailer.createTransport({
            host: process.env.EMAIL_SMTP_HOST || 'smtp.gmail.com',
            port: 587,
            secure: false,
            auth: {
                user: process.env.EMAIL_USER,
                pass: emailPassword,
            },
        });
    }
    return smtpTransporter;
}

// ─────────────────────────────────────────
// IMAP Email Reader (خواندن ایمیل)
// ─────────────────────────────────────────

/**
 * دریافت ایمیل‌های اخیر
 * @param {number} limit - تعداد ایمیل
 * @param {string} folder - پوشه (INBOX, Sent, etc.)
 * @param {boolean} unreadOnly - فقط خوانده نشده‌ها
 */
async function getEmails(limit = 10, folder = 'INBOX', unreadOnly = false) {
    try {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
            return { 
                success: false, 
                error: 'ایمیل تنظیم نشده است. EMAIL_USER و EMAIL_PASSWORD را در .env تنظیم کنید.' 
            };
        }

        // استفاده از node-imap برای خواندن ایمیل
        const Imap = require('imap');
        const { simpleParser } = require('mailparser');

        return new Promise((resolve) => {
            const emailPassword = (process.env.EMAIL_PASSWORD || '').replace(/\s+/g, '');
            const imap = new Imap({
                user: process.env.EMAIL_USER,
                password: emailPassword,
                host: process.env.EMAIL_IMAP_HOST || 'imap.gmail.com',
                port: 993,
                tls: true,
                tlsOptions: { rejectUnauthorized: false },
                authTimeout: 10000,
            });

            const emails = [];

            imap.once('ready', () => {
                imap.openBox(folder, true, (err, box) => {
                    if (err) {
                        resolve({ success: false, error: err.message });
                        return;
                    }

                    const criteria = unreadOnly ? ['UNSEEN'] : ['ALL'];
                    
                    imap.search(criteria, (err, results) => {
                        if (err || !results || results.length === 0) {
                            imap.end();
                            resolve({ success: true, emails: [], count: 0 });
                            return;
                        }

                        // آخرین N ایمیل
                        const fetchIds = results.slice(-limit);
                        const fetch = imap.fetch(fetchIds, { bodies: '' });

                        fetch.on('message', (msg) => {
                            msg.on('body', (stream) => {
                                simpleParser(stream, (err, parsed) => {
                                    if (!err && parsed) {
                                        emails.push({
                                            id: parsed.messageId,
                                            from: parsed.from?.text || '',
                                            to: parsed.to?.text || '',
                                            subject: parsed.subject || '(بدون موضوع)',
                                            date: parsed.date?.toISOString() || '',
                                            body: parsed.text?.substring(0, 500) || '',
                                            html: false,
                                            attachments: parsed.attachments?.length || 0,
                                        });
                                    }
                                });
                            });
                        });

                        fetch.once('end', () => {
                            imap.end();
                            log.log.run('GET_EMAILS', `دریافت ${emails.length} ایمیل`, '', 1);
                            resolve({ 
                                success: true, 
                                count: emails.length, 
                                emails: emails.reverse() // جدیدترین اول
                            });
                        });
                    });
                });
            });

            imap.once('error', (err) => {
                resolve({ success: false, error: err.message });
            });

            imap.connect();
        });
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * ارسال ایمیل
 * @param {string} to - آدرس گیرنده
 * @param {string} subject - موضوع
 * @param {string} body - متن ایمیل
 * @param {boolean} isHtml - آیا HTML است؟
 */
async function sendEmail(to, subject, body, isHtml = false) {
    try {
        const transporter = getSmtpTransporter();
        
        const mailOptions = {
            from: `"Hassan AI Agent" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            [isHtml ? 'html' : 'text']: body,
        };

        const info = await transporter.sendMail(mailOptions);
        
        log.log.run('SEND_EMAIL', `ارسال ایمیل به ${to}: ${subject}`, info.messageId, 1);
        return { 
            success: true, 
            messageId: info.messageId,
            message: `ایمیل با موفقیت به ${to} ارسال شد.`
        };
    } catch (error) {
        log.log.run('SEND_EMAIL', `خطا در ارسال ایمیل به ${to}`, error.message, 0);
        return { success: false, error: error.message };
    }
}

/**
 * جستجو در ایمیل‌ها
 * @param {string} query - کلمه کلیدی
 */
async function searchEmails(query) {
    try {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
            return { success: false, error: 'ایمیل تنظیم نشده است.' };
        }

        const Imap = require('imap');
        const { simpleParser } = require('mailparser');

        return new Promise((resolve) => {
            const emailPassword = (process.env.EMAIL_PASSWORD || '').replace(/\s+/g, '');
            const imap = new Imap({
                user: process.env.EMAIL_USER,
                password: emailPassword,
                host: process.env.EMAIL_IMAP_HOST || 'imap.gmail.com',
                port: 993,
                tls: true,
                tlsOptions: { rejectUnauthorized: false },
            });

            imap.once('ready', () => {
                imap.openBox('INBOX', true, (err) => {
                    if (err) { resolve({ success: false, error: err.message }); return; }

                    imap.search([['TEXT', query]], (err, results) => {
                        if (err || !results?.length) {
                            imap.end();
                            resolve({ success: true, emails: [], count: 0 });
                            return;
                        }

                        const emails = [];
                        const fetch = imap.fetch(results.slice(-20), { bodies: '' });

                        fetch.on('message', (msg) => {
                            msg.on('body', (stream) => {
                                simpleParser(stream, (err, parsed) => {
                                    if (!err && parsed) {
                                        emails.push({
                                            from: parsed.from?.text || '',
                                            subject: parsed.subject || '',
                                            date: parsed.date?.toISOString() || '',
                                            body: parsed.text?.substring(0, 300) || '',
                                        });
                                    }
                                });
                            });
                        });

                        fetch.once('end', () => {
                            imap.end();
                            resolve({ success: true, count: emails.length, emails });
                        });
                    });
                });
            });

            imap.once('error', (err) => resolve({ success: false, error: err.message }));
            imap.connect();
        });
    } catch (error) {
        return { success: false, error: error.message };
    }
}

module.exports = { getEmails, sendEmail, searchEmails };
