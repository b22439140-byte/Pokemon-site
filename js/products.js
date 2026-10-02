let PRODUCTS = [];

function formatEuro(amount) {
    return '€' + Number(amount).toFixed(2).replace('.', ',');
}

function getProductById(id) {
    return PRODUCTS.find((p) => p.id === id) || null;
}

function getProductImages(product) {
    if (!product) return [];
    if (Array.isArray(product.images) && product.images.length) {
        return product.images.filter(Boolean);
    }
    return product.image ? [product.image] : [];
}

async function loadProducts() {
    const res = await fetch('/api/products');
    if (!res.ok) {
        throw new Error('Producten konden niet worden geladen.');
    }
    PRODUCTS = await res.json();
    return PRODUCTS;
}
