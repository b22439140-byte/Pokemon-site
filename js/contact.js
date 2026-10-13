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
        if (!res.ok) throw new Error('Product niet gevonden');
        const product = await res.json();

        productIdInput.value = product.id;
        productTitleInput.value = product.title;
        titleEl.textContent = 'Interesse in dit product';
        subjectSelect.value = 'interest';
        if (!messageEl.value) {
            messageEl.placeholder = `Hallo, ik ben geïnteresseerd in “${product.title}”. …`;
        }

        banner.hidden = false;
        banner.innerHTML = `
            <img src="${escapeHtml(product.image || '')}" alt="">
            <div>
                <strong>${escapeHtml(product.title)}</strong>
                <span>${formatEuro(product.price)} · we nemen contact met je op</span>
            </div>
        `;
    } catch {
        productIdInput.value = productId;
        titleEl.textContent = 'Neem contact op over dit product';
        subjectSelect.value = 'interest';
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
        submitBtn.textContent = 'Versturen…';

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
                throw new Error(data.error || 'Versturen mislukt.');
            }

            const keptProductId = form.productId.value;
            const keptProductTitle = form.productTitle.value;
            form.reset();
            form.productId.value = keptProductId;
            form.productTitle.value = keptProductTitle;
            if (keptProductId) {
                form.subject.value = 'interest';
            }
            successEl.classList.add('visible');
        } catch (err) {
            errorEl.textContent = err.message || 'Er ging iets mis. Probeer het opnieuw.';
            errorEl.classList.add('visible');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Verstuur bericht';
        }
    });
});
