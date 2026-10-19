const nodemailer = require('nodemailer');

const SMTP_HOST = String(process.env.SMTP_HOST || '').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = /^(1|true|yes)$/i.test(String(process.env.SMTP_SECURE || '').trim());
const SMTP_USER = String(process.env.SMTP_USER || '').trim();
const SMTP_PASS = String(process.env.SMTP_PASS || '').trim();
const MAIL_FROM = String(process.env.MAIL_FROM || SMTP_USER || '').trim();
const MAIL_NOTIFY_TO = String(process.env.MAIL_NOTIFY_TO || '').trim();
const BRAND = 'PokeVault';

let transporter = null;

function isConfigured() {
    return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && MAIL_FROM);
}

function getTransporter() {
    if (!isConfigured()) return null;
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: Number.isFinite(SMTP_PORT) ? SMTP_PORT : 587,
            secure: SMTP_SECURE,
            auth: {
                user: SMTP_USER,
                pass: SMTP_PASS
            }
        });
    }
    return transporter;
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

function orderSummaryHtml(order, { includePayment = false, orderUrl = null } = {}) {
    const paymentMethod = order.paymentMethod === 'crypto' ? 'Crypto' : 'iDEAL / bunq';
    const shippingLabel = Number(order.shipping) === 0 ? 'Gratis' : formatEuro(order.shipping);
    const paymentBlock = includePayment
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
      <p style="margin:0 0 16px;font-size:14px;color:#6b6560;"><strong>Betaalmethode:</strong> ${escapeHtml(paymentMethod)}</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:15px;line-height:1.4;">
        ${itemsRowsHtml(order.items)}
        <tr>
          <td style="padding:10px 0 4px;color:#6b6560;">Subtotaal</td>
          <td style="padding:10px 0 4px;text-align:right;">${formatEuro(order.subtotal)}</td>
        </tr>
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
    const lines = [
        `Bestelnummer: ${order.id}`,
        `Betaalmethode: ${order.paymentMethod === 'crypto' ? 'Crypto' : 'iDEAL / bunq'}`,
        '',
        ...(order.items || []).map(
            (item) => `- ${item.title} × ${item.quantity}: ${formatEuro(item.lineTotal)}`
        ),
        '',
        `Subtotaal: ${formatEuro(order.subtotal)}`,
        `Verzending: ${Number(order.shipping) === 0 ? 'Gratis' : formatEuro(order.shipping)}`,
        `Totaal: ${formatEuro(order.total)}`
    ];

    if (includePayment) {
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
    const transport = getTransporter();
    if (!transport) {
        console.warn('E-mail overgeslagen: SMTP is niet geconfigureerd (SMTP_HOST/USER/PASS/MAIL_FROM).');
        return { skipped: true };
    }

    const info = await transport.sendMail({
        from: MAIL_FROM.includes('<') ? MAIL_FROM : `${BRAND} <${MAIL_FROM}>`,
        to,
        subject,
        text,
        html
    });

    return { skipped: false, messageId: info.messageId };
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
    const subject = `Bestelling ontvangen – ${BRAND} #${String(order.id).slice(0, 8)}`;
    const intro = `Hoi ${name}, bedankt voor je bestelling! We hebben hem ontvangen.`;
    const bodyHtml = orderSummaryHtml(order, {
        includePayment: order.status !== 'paid',
        orderUrl
    });
    const html = emailShell({
        title: 'Je bestelling is ontvangen',
        intro,
        bodyHtml,
        footerNote: `Met vriendelijke groet,\n${BRAND}`
    });
    const text = [
        intro,
        '',
        orderSummaryText(order, { includePayment: order.status !== 'paid', orderUrl }),
        '',
        `Met vriendelijke groet,`,
        BRAND
    ].join('\n');

    return sendMail({ to, subject, text, html });
}

async function sendPaymentConfirmation(order, { orderUrl } = {}) {
    const to = order.customer?.email;
    if (!to) return { skipped: true, reason: 'no-email' };

    const name = order.customer?.name || 'klant';
    const subject = `Betaling ontvangen – ${BRAND} #${String(order.id).slice(0, 8)}`;
    const intro = `Hoi ${name}, we hebben je betaling ontvangen. We gaan je bestelling zo snel mogelijk verzenden.`;
    const bodyHtml = orderSummaryHtml(order, { includePayment: false, orderUrl });
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
        '',
        `Met vriendelijke groet,`,
        BRAND
    ].join('\n');

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

async function notifyOrderPaid(order, { orderUrl } = {}) {
    if (order.status !== 'paid') return { skipped: true, reason: 'not-paid' };

    const emails = ensureEmails(order);
    if (emails.paymentConfirmationSentAt) {
        return { skipped: true, reason: 'already-sent' };
    }

    try {
        const result = await sendPaymentConfirmation(order, { orderUrl });
        if (!result.skipped) {
            emails.paymentConfirmationSentAt = new Date().toISOString();
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

module.exports = {
    isConfigured,
    notifyOrderPlaced,
    notifyOrderPaid,
    orderPageUrl
};
