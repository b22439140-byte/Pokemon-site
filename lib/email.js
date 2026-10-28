const nodemailer = require('nodemailer');
const { domainToASCII } = require('url');

// Prefer Resend (API key). SMTP/Strato remains an optional fallback.
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || '').trim();
const SMTP_HOST = String(process.env.SMTP_HOST || '').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = /^(1|true|yes)$/i.test(String(process.env.SMTP_SECURE || 'true').trim());
const SMTP_USER = String(process.env.SMTP_USER || '').trim();
const SMTP_PASS = String(process.env.SMTP_PASS || '').trim();
const MAIL_FROM = String(
    process.env.MAIL_FROM || SMTP_USER || 'PokeVault <onboarding@resend.dev>'
).trim();
const MAIL_NOTIFY_TO = String(process.env.MAIL_NOTIFY_TO || '').trim();
const BRAND = 'PokeVault';

function usesResend() {
    return Boolean(RESEND_API_KEY);
}

function usesSmtp() {
    return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function providerName() {
    if (usesResend()) return 'resend';
    if (usesSmtp()) return 'smtp';
    return 'none';
}

/**
 * Punycode form for SMTP / Resend.
 * info@pokëvault.com → info@xn--pokvault-v1a.com
 */
function toAsciiEmail(address) {
    const raw = String(address || '')
        .trim()
        // Strip invisible/weird unicode spaces people paste from phones
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .normalize('NFC');
    if (!raw) return raw;
    const at = raw.lastIndexOf('@');
    if (at < 1) return raw;
    // Local-part must stay ASCII for Resend; keep as typed if already ASCII
    const local = raw.slice(0, at).replace(/[^\x20-\x7E]/g, '');
    const domain = raw.slice(at + 1);
    try {
        const asciiDomain = domainToASCII(domain);
        if (!asciiDomain) return raw;
        return `${local}@${asciiDomain}`;
    } catch {
        return raw;
    }
}

function isAsciiEmailAddress(address) {
    const raw = String(address || '').trim();
    const bare = raw.includes('<') ? (raw.match(/<([^>]+)>/) || [])[1] || raw : raw;
    return Boolean(bare) && !/[^\x00-\x7F]/.test(bare);
}

function authUserCandidates() {
    const unicode = SMTP_USER;
    const ascii = toAsciiEmail(SMTP_USER);
    const list = [unicode];
    if (ascii && ascii !== unicode) list.push(ascii);
    const lower = unicode.replace(/^[^@]+/, (local) => local.toLowerCase());
    if (lower && !list.includes(lower)) list.push(lower);
    const lowerAscii = toAsciiEmail(lower);
    if (lowerAscii && !list.includes(lowerAscii)) list.push(lowerAscii);
    return list;
}

let transporter = null;
let activeAuthUser = SMTP_USER;

function isConfigured() {
    return Boolean(MAIL_FROM && (usesResend() || usesSmtp()));
}

/**
 * Resend rejects non-ASCII in the address (ë in pokëvault.com).
 * Display name stays ASCII; domain becomes punycode.
 * PokeVault <Info@pokëvault.com> → PokeVault <Info@xn--pokvault-v1a.com>
 */
function normalizeFromHeader(from) {
    const raw = String(from || '').trim();
    const match = raw.match(/^(.*?)\s*<([^>]+)>\s*$/);
    const nameRaw = match ? match[1].trim() : BRAND;
    // Resend is picky — keep display name ASCII-only
    const name = (nameRaw || BRAND).replace(/[^\x20-\x7E]/g, '').trim() || BRAND;
    const addr = toAsciiEmail(match ? match[2] : raw);
    if (!addr || !addr.includes('@') || !isAsciiEmailAddress(addr)) {
        throw new Error(
            'MAIL_FROM heeft non-ASCII tekens. Gebruik bv. PokeVault <Info@xn--pokvault-v1a.com> (punycode voor pokëvault.com).'
        );
    }
    return `${name} <${addr}>`;
}

function fromHeader() {
    return normalizeFromHeader(MAIL_FROM);
}

function createTransport(authUser) {
    const port = Number.isFinite(SMTP_PORT) ? SMTP_PORT : 465;
    return nodemailer.createTransport({
        host: SMTP_HOST,
        port,
        secure: port === 465 ? true : SMTP_SECURE,
        requireTLS: port === 587,
        auth: {
            user: authUser,
            pass: SMTP_PASS
        },
        authMethod: 'LOGIN',
        tls: {
            minVersion: 'TLSv1.2'
        }
    });
}

async function resolveTransporter() {
    if (!usesSmtp()) return null;
    if (transporter) return transporter;

    const candidates = authUserCandidates();
    let lastError = null;
    for (const user of candidates) {
        const candidate = createTransport(user);
        try {
            await candidate.verify();
            transporter = candidate;
            activeAuthUser = user;
            if (user !== SMTP_USER) {
                console.log(`SMTP login gelukt met gebruikersnaam-variant: ${user}`);
            }
            return transporter;
        } catch (err) {
            lastError = err;
            console.warn(`SMTP login mislukt als ${user}:`, err.message || err);
        }
    }

    transporter = createTransport(candidates[0]);
    activeAuthUser = candidates[0];
    if (lastError) throw lastError;
    return transporter;
}

function getTransporter() {
    if (!usesSmtp()) return null;
    if (!transporter) {
        transporter = createTransport(SMTP_USER);
        activeAuthUser = SMTP_USER;
    }
    return transporter;
}

async function sendViaResend({ to, subject, text, html }) {
    const payload = {
        from: fromHeader(),
        to: [toAsciiEmail(to) || to],
        subject,
        text,
        html
    };
    if (MAIL_NOTIFY_TO) {
        payload.reply_to = toAsciiEmail(MAIL_NOTIFY_TO) || MAIL_NOTIFY_TO;
    }

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message =
            data?.message ||
            data?.error?.message ||
            (typeof data?.error === 'string' ? data.error : null) ||
            `Resend fout (${response.status})`;
        throw new Error(message);
    }
    return { skipped: false, messageId: data.id || null, provider: 'resend' };
}

async function verifySmtp() {
    if (!isConfigured()) {
        return {
            ok: false,
            error: 'E-mail is niet geconfigureerd. Zet RESEND_API_KEY (aanbevolen) of SMTP_* in.'
        };
    }
    if (usesResend()) {
        return {
            ok: true,
            provider: 'resend',
            host: 'api.resend.com',
            user: 'RESEND_API_KEY',
            from: MAIL_FROM
        };
    }
    try {
        transporter = null;
        await resolveTransporter();
        return {
            ok: true,
            provider: 'smtp',
            host: SMTP_HOST,
            user: activeAuthUser,
            from: MAIL_FROM
        };
    } catch (err) {
        return {
            ok: false,
            provider: 'smtp',
            host: SMTP_HOST,
            user: SMTP_USER,
            from: MAIL_FROM,
            error: err.message || String(err)
        };
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatEuro(amount) {
    return `€${Number(amount).toFixed(2).replace('.', ',')}`;
}

function formatAddress(address) {
    if (!address) return '';
    const parts = [
        address.line1,
        address.line2,
        [address.postalCode, address.city].filter(Boolean).join(' '),
        address.country
    ].filter(Boolean);
    return parts.join(', ');
}

function itemsRowsHtml(items) {
    return (items || [])
        .map(
            (item) => `
            <tr>
                <td style="padding:8px 0;border-bottom:1px solid #ece8e1;">
                    ${escapeHtml(item.title)}
                    <span style="color:#6b6560;"> × ${Number(item.quantity) || 1}</span>
                </td>
                <td style="padding:8px 0;border-bottom:1px solid #ece8e1;text-align:right;white-space:nowrap;">
                    ${formatEuro(item.lineTotal)}
                </td>
            </tr>`
        )
        .join('');
}

function emailShell({ title, intro, bodyHtml, footerNote }) {
    return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f1ec;font-family:Georgia,'Times New Roman',serif;color:#1a1814;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ec;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#fffdf8;border:1px solid #e4ddd3;padding:32px 28px;">
        <tr><td>
          <p style="margin:0 0 4px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#8a8178;">${BRAND}</p>
          <h1 style="margin:0 0 16px;font-size:24px;font-weight:normal;line-height:1.3;">${escapeHtml(title)}</h1>
          <p style="margin:0 0 24px;font-size:16px;line-height:1.55;color:#3d3832;">${escapeHtml(intro)}</p>
          ${bodyHtml}
          <p style="margin:28px 0 0;font-size:13px;line-height:1.5;color:#8a8178;">${escapeHtml(footerNote || `Met vriendelijke groet,\n${BRAND}`).replace(/\n/g, '<br>')}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function isOrderPaid(order) {
    return String(order?.status || '').toLowerCase() === 'paid';
}

function orderStatusLabel(order) {
    return isOrderPaid(order) ? 'Betaald' : 'Nog te betalen';
}

function orderSummaryHtml(order, { includePayment = false, orderUrl = null } = {}) {
    const paymentMethod = order.paymentMethod === 'crypto' ? 'Crypto' : 'iDEAL / bunq';
    const shippingLabel = Number(order.shipping) === 0 ? 'Gratis' : formatEuro(order.shipping);
    // Never show a pay CTA after the order is already paid (even if caller passes true).
    const showPayCta = includePayment && !isOrderPaid(order);
    const paymentBlock = showPayCta
        ? order.paymentMethod === 'crypto'
            ? `<p style="margin:16px 0 0;font-size:15px;line-height:1.5;">Betaal via crypto het exacte bedrag van <strong>${formatEuro(order.total)}</strong>. Vermeld indien mogelijk je bestelnummer.</p>`
            : order.paymentUrl
                ? `<p style="margin:20px 0 0;"><a href="${escapeHtml(order.paymentUrl)}" style="display:inline-block;background:#1a1814;color:#fffdf8;text-decoration:none;padding:12px 20px;font-size:15px;">Nu betalen</a></p>
                   <p style="margin:10px 0 0;font-size:13px;color:#6b6560;">Of open: ${escapeHtml(order.paymentUrl)}</p>`
                : ''
        : '';

    const trackBlock = orderUrl
        ? `<p style="margin:16px 0 0;font-size:14px;"><a href="${escapeHtml(orderUrl)}" style="color:#1a1814;">Bekijk je bestelling</a></p>`
        : '';

    return `
      <p style="margin:0 0 8px;font-size:14px;color:#6b6560;"><strong>Bestelnummer:</strong> ${escapeHtml(order.id)}</p>
      <p style="margin:0 0 8px;font-size:14px;color:#6b6560;"><strong>Status:</strong> ${escapeHtml(orderStatusLabel(order))}</p>
      <p style="margin:0 0 16px;font-size:14px;color:#6b6560;"><strong>Betaalmethode:</strong> ${escapeHtml(paymentMethod)}</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:15px;line-height:1.4;">
        ${itemsRowsHtml(order.items)}
        <tr>
          <td style="padding:10px 0 4px;color:#6b6560;">Subtotaal</td>
          <td style="padding:10px 0 4px;text-align:right;">${formatEuro(order.subtotal)}</td>
        </tr>
        ${Number(order.discount) > 0 ? `
        <tr>
          <td style="padding:4px 0;color:#6b6560;">Korting${order.discountCode ? ` (${escapeHtml(order.discountCode)})` : ''}</td>
          <td style="padding:4px 0;text-align:right;">−${formatEuro(order.discount)}</td>
        </tr>` : ''}
        <tr>
          <td style="padding:4px 0;color:#6b6560;">Verzending</td>
          <td style="padding:4px 0;text-align:right;">${shippingLabel}</td>
        </tr>
        <tr>
          <td style="padding:12px 0 0;font-size:17px;"><strong>Totaal</strong></td>
          <td style="padding:12px 0 0;text-align:right;font-size:17px;"><strong>${formatEuro(order.total)}</strong></td>
        </tr>
      </table>
      ${paymentBlock}
      ${trackBlock}
    `;
}

function orderSummaryText(order, { includePayment = false, orderUrl = null } = {}) {
    const showPayCta = includePayment && !isOrderPaid(order);
    const lines = [
        `Bestelnummer: ${order.id}`,
        `Status: ${orderStatusLabel(order)}`,
        `Betaalmethode: ${order.paymentMethod === 'crypto' ? 'Crypto' : 'iDEAL / bunq'}`,
        '',
        ...(order.items || []).map(
            (item) => `- ${item.title} × ${item.quantity}: ${formatEuro(item.lineTotal)}`
        ),
        '',
        `Subtotaal: ${formatEuro(order.subtotal)}`,
        ...(Number(order.discount) > 0
            ? [`Korting${order.discountCode ? ` (${order.discountCode})` : ''}: −${formatEuro(order.discount)}`]
            : []),
        `Verzending: ${Number(order.shipping) === 0 ? 'Gratis' : formatEuro(order.shipping)}`,
        `Totaal: ${formatEuro(order.total)}`
    ];

    if (showPayCta) {
        if (order.paymentMethod === 'crypto') {
            lines.push('', `Betaal via crypto het exacte bedrag van ${formatEuro(order.total)}.`);
        } else if (order.paymentUrl) {
            lines.push('', `Betaal hier: ${order.paymentUrl}`);
        }
    }
    if (orderUrl) {
        lines.push('', `Bekijk je bestelling: ${orderUrl}`);
    }
    return lines.join('\n');
}

async function sendMail({ to, subject, text, html }) {
    if (!isConfigured()) {
        console.warn(
            'E-mail overgeslagen: zet RESEND_API_KEY (aanbevolen) of SMTP_HOST/USER/PASS + MAIL_FROM.'
        );
        return { skipped: true };
    }

    if (usesResend()) {
        return sendViaResend({ to, subject, text, html });
    }

    let transport;
    try {
        transport = await resolveTransporter();
    } catch (_) {
        transport = getTransporter();
    }
    if (!transport) {
        console.warn('E-mail overgeslagen: SMTP is niet geconfigureerd.');
        return { skipped: true };
    }

    const info = await transport.sendMail({
        from: fromHeader(),
        to,
        subject,
        text,
        html
    });

    return { skipped: false, messageId: info.messageId, provider: 'smtp' };
}

function ensureEmails(order) {
    if (!order.emails || typeof order.emails !== 'object') {
        order.emails = {};
    }
    return order.emails;
}

async function sendOrderConfirmation(order, { orderUrl } = {}) {
    const to = order.customer?.email;
    if (!to) return { skipped: true, reason: 'no-email' };

    const name = order.customer?.name || 'klant';
    const paid = isOrderPaid(order);
    const isCrypto = order.paymentMethod === 'crypto';
    const shortId = String(order.id).slice(0, 8);

    // Paid: confirmation only, never a pay button.
    // Crypto (manual): thank-you + we'll contact you soon.
    // Unpaid bunq: clear "still need to pay" copy + Nu betalen CTA.
    let subject;
    let title;
    let intro;
    if (paid) {
        subject = `Bestelling bevestigd – ${BRAND} #${shortId}`;
        title = 'Je bestelling is bevestigd';
        intro = `Hoi ${name}, bedankt voor je bestelling! We hebben je betaling ontvangen en gaan zo snel mogelijk verzenden.`;
    } else if (isCrypto) {
        subject = `Bedankt voor je aankoop – ${BRAND} #${shortId}`;
        title = 'Bedankt voor je aankoop';
        intro = `Hoi ${name}, bedankt voor je aankoop! We hebben je crypto-bestelling ontvangen en nemen zo spoedig mogelijk contact met je op over de betaling en verdere afhandeling.`;
    } else {
        subject = `Nog te betalen – ${BRAND} #${shortId}`;
        title = 'Je bestelling is geplaatst';
        intro = `Hoi ${name}, bedankt voor je bestelling! Je betaling staat nog open — rond die af om je order te bevestigen.`;
    }

    const includePayment = !paid && !isCrypto;
    const bodyHtml = orderSummaryHtml(order, {
        includePayment,
        orderUrl
    });
    const html = emailShell({
        title,
        intro,
        bodyHtml,
        footerNote: `Met vriendelijke groet,\n${BRAND}`
    });
    const text = [
        intro,
        '',
        orderSummaryText(order, { includePayment, orderUrl }),
        '',
        `Met vriendelijke groet,`,
        BRAND
    ].join('\n');

    return sendMail({ to, subject, text, html });
}

async function sendPaymentConfirmation(order, { orderUrl, reviewUrl } = {}) {
    const to = order.customer?.email;
    if (!to) return { skipped: true, reason: 'no-email' };

    const name = order.customer?.name || 'klant';
    const subject = `Betaald – ${BRAND} #${String(order.id).slice(0, 8)}`;
    const intro = `Hoi ${name}, we hebben je betaling ontvangen. We gaan je bestelling zo snel mogelijk verzenden.`;
    // Always omit pay CTA — this mail only goes out after status=paid.
    const reviewBlock = reviewUrl
        ? `<p style="margin:24px 0 0;padding:16px;background:#f4f1ec;border:1px solid #e4ddd3;font-size:15px;line-height:1.5;">
             Tevreden over je aankoop? <a href="${escapeHtml(reviewUrl)}" style="color:#1a1814;font-weight:bold;">Laat een review achter</a> — dat helpt andere collectors enorm.
           </p>`
        : '';
    const bodyHtml = `${orderSummaryHtml(order, { includePayment: false, orderUrl })}${reviewBlock}`;
    const html = emailShell({
        title: 'Betaling ontvangen',
        intro,
        bodyHtml,
        footerNote: `Met vriendelijke groet,\n${BRAND}`
    });
    const text = [
        intro,
        '',
        orderSummaryText(order, { includePayment: false, orderUrl }),
        reviewUrl ? `\nTevreden over je aankoop? Laat een review achter: ${reviewUrl}` : null,
        '',
        `Met vriendelijke groet,`,
        BRAND
    ]
        .filter((line) => line != null)
        .join('\n');

    return sendMail({ to, subject, text, html });
}

async function sendShopNewOrderNotice(order, { orderUrl } = {}) {
    if (!MAIL_NOTIFY_TO) return { skipped: true, reason: 'no-notify-to' };

    const subject = `Nieuwe bestelling – ${BRAND} #${String(order.id).slice(0, 8)}`;
    const customer = order.customer || {};
    const address = formatAddress(customer.address);
    const intro = `Nieuwe bestelling van ${customer.name || 'onbekend'} (${customer.email || 'geen e-mail'}).`;
    const bodyHtml = `
      ${orderSummaryHtml(order, { includePayment: false, orderUrl })}
      <p style="margin:20px 0 0;font-size:14px;color:#6b6560;">
        <strong>Klant:</strong> ${escapeHtml(customer.name)}<br>
        <strong>E-mail:</strong> ${escapeHtml(customer.email)}<br>
        ${customer.phone ? `<strong>Telefoon:</strong> ${escapeHtml(customer.phone)}<br>` : ''}
        ${address ? `<strong>Adres:</strong> ${escapeHtml(address)}` : ''}
      </p>
    `;
    const html = emailShell({
        title: 'Nieuwe bestelling',
        intro,
        bodyHtml,
        footerNote: `${BRAND} – automatische melding`
    });
    const text = [
        intro,
        '',
        orderSummaryText(order, { includePayment: false, orderUrl }),
        '',
        `Klant: ${customer.name || ''}`,
        `E-mail: ${customer.email || ''}`,
        customer.phone ? `Telefoon: ${customer.phone}` : null,
        address ? `Adres: ${address}` : null
    ]
        .filter(Boolean)
        .join('\n');

    return sendMail({ to: MAIL_NOTIFY_TO, subject, text, html });
}

/**
 * Fire-and-forget safe senders that persist sent flags on the order object.
 * Caller is responsible for writing the order after these return.
 */
async function notifyOrderPlaced(order, { orderUrl } = {}) {
    const emails = ensureEmails(order);
    const results = {};

    if (!emails.orderConfirmationSentAt) {
        try {
            const result = await sendOrderConfirmation(order, { orderUrl });
            results.orderConfirmation = result;
            if (!result.skipped) {
                emails.orderConfirmationSentAt = new Date().toISOString();
            }
        } catch (err) {
            console.error('Orderbevestiging e-mail mislukt:', err.message || err);
            results.orderConfirmation = { error: err.message || String(err) };
        }
    }

    if (!emails.shopNotifySentAt) {
        try {
            const result = await sendShopNewOrderNotice(order, { orderUrl });
            results.shopNotify = result;
            if (!result.skipped) {
                emails.shopNotifySentAt = new Date().toISOString();
            }
        } catch (err) {
            console.error('Shop-notificatie e-mail mislukt:', err.message || err);
            results.shopNotify = { error: err.message || String(err) };
        }
    }

    return results;
}

async function notifyOrderPaid(order, { orderUrl, reviewUrl } = {}) {
    if (order.status !== 'paid') return { skipped: true, reason: 'not-paid' };

    const emails = ensureEmails(order);
    if (emails.paymentConfirmationSentAt) {
        return { skipped: true, reason: 'already-sent' };
    }

    try {
        const result = await sendPaymentConfirmation(order, { orderUrl, reviewUrl });
        if (!result.skipped) {
            emails.paymentConfirmationSentAt = new Date().toISOString();
            if (reviewUrl) {
                emails.reviewInviteSentAt = new Date().toISOString();
            }
        }
        return result;
    } catch (err) {
        console.error('Betalingsbevestiging e-mail mislukt:', err.message || err);
        return { error: err.message || String(err) };
    }
}

function orderPageUrl(order, baseUrl) {
    const base = String(baseUrl || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    if (!base || !order?.id) return null;
    return `${base}/bestelling?order=${encodeURIComponent(order.id)}`;
}

function reviewPageUrl(order, baseUrl) {
    const base = String(baseUrl || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    if (!base || !order?.id) return null;
    return `${base}/review?order=${encodeURIComponent(order.id)}`;
}

module.exports = {
    isConfigured,
    providerName,
    verifySmtp,
    notifyOrderPlaced,
    notifyOrderPaid,
    orderPageUrl,
    reviewPageUrl
};
