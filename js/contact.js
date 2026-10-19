function formatEuro(amount) {
    return '€' + Number(amount).toFixed(2).replace('.', ',');
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function tr(key, vars) {
    return typeof t === 'function' ? t(key, vars) : key;
}

let contactProduct = null;
let contactProductIdFallback = null;

async function loadProductContext() {
    const params = new URLSearchParams(window.location.search);
    const productId = params.get('product');
    if (!productId) return;

    const banner = document.getElementById('contact-product-banner');
    const titleEl = document.getElementById('contact-form-title');
    const productIdInput = document.getElementById('productId');
    const productTitleInput = document.getElementById('productTitle');
    const subjectSelect = document.getElementById('subject');
    const messageEl = document.getElementById('message');

    try {
        const res = await fetch(`/api/products/${encodeURIComponent(productId)}`);
        if (!res.ok) throw new Error(tr('contact.productNotFound'));
        const product = await res.json();
        contactProduct = product;
        contactProductIdFallback = null;

        productIdInput.value = product.id;
        productTitleInput.value = product.title;
        applyProductContextUI();
        if (!messageEl.value) {
            messageEl.setAttribute('placeholder', tr('contact.messageInterest', { title: product.title }));
        }
        subjectSelect.value = 'interest';
    } catch {
        contactProduct = null;
        contactProductIdFallback = productId;
        productIdInput.value = productId;
        titleEl.textContent = tr('contact.productTitle');
        subjectSelect.value = 'interest';
        banner.hidden = true;
    }
}

function applyProductContextUI() {
    const banner = document.getElementById('contact-product-banner');
    const titleEl = document.getElementById('contact-form-title');
    const messageEl = document.getElementById('message');

    if (contactProduct) {
        titleEl.textContent = tr('contact.interestTitle');
        banner.hidden = false;
        banner.innerHTML = `
            <img src="${escapeHtml(contactProduct.image || '')}" alt="">
            <div>
                <strong>${escapeHtml(contactProduct.title)}</strong>
                <span>${tr('contact.bannerFollowUp', { price: formatEuro(contactProduct.price) })}</span>
            </div>
        `;
        if (messageEl && !messageEl.value) {
            messageEl.setAttribute('placeholder', tr('contact.messageInterest', { title: contactProduct.title }));
        }
    } else if (contactProductIdFallback) {
        titleEl.textContent = tr('contact.productTitle');
        if (banner) banner.hidden = true;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('contact-form');
    const successEl = document.getElementById('form-success');
    const errorEl = document.getElementById('form-error');
    const submitBtn = document.getElementById('contact-submit');

    loadProductContext();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        successEl.classList.remove('visible');
        errorEl.classList.remove('visible');
        errorEl.textContent = '';
        submitBtn.disabled = true;
        submitBtn.textContent = tr('contact.sending');

        const payload = {
            name: form.name.value.trim(),
            email: form.email.value.trim(),
            phone: form.phone.value.trim(),
            subject: form.subject.value,
            order: form.order.value.trim(),
            message: form.message.value.trim(),
            productId: form.productId.value.trim(),
            productTitle: form.productTitle.value.trim()
        };

        try {
            const res = await fetch('/api/contact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || tr('contact.sendFailed'));
            }

            const keptProductId = form.productId.value;
            const keptProductTitle = form.productTitle.value;
            form.reset();
            form.productId.value = keptProductId;
            form.productTitle.value = keptProductTitle;
            if (keptProductId) {
                form.subject.value = 'interest';
            }
            successEl.textContent = tr('contact.success');
            successEl.classList.add('visible');
            applyProductContextUI();
        } catch (err) {
            errorEl.textContent = err.message || tr('contact.genericError');
            errorEl.classList.add('visible');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = tr('contact.submit');
        }
    });

    window.addEventListener('pokevault:langchange', () => {
        if (!contactProduct && !contactProductIdFallback) {
            const titleEl = document.getElementById('contact-form-title');
            if (titleEl) titleEl.textContent = tr('contact.formTitle');
        } else {
            applyProductContextUI();
        }
        if (submitBtn && !submitBtn.disabled) {
            submitBtn.textContent = tr('contact.submit');
        }
        if (successEl) successEl.textContent = tr('contact.success');
    });
});
