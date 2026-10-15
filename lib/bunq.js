const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PRODUCTION_HOST = 'https://api.bunq.com';
const SANDBOX_HOST = 'https://public-api.sandbox.bunq.com';

function createBunqClient({ apiKey, persistDir, sandbox = false, monetaryAccountId = null }) {
    if (!apiKey) {
        throw new Error('BUNQ_API_KEY ontbreekt.');
    }

    const baseUrl = `${sandbox ? SANDBOX_HOST : PRODUCTION_HOST}/v1`;
    const statePath = path.join(persistDir, 'bunq-state.json');
    let state = loadState(statePath);
    let sessionPromise = null;

    function loadState(filePath) {
        try {
            if (!fs.existsSync(filePath)) return {};
            return JSON.parse(fs.readFileSync(filePath, 'utf8')) || {};
        } catch {
            return {};
        }
    }

    function saveState() {
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    }

    function ensureKeyPair() {
        if (state.privateKeyPem && state.publicKeyPem) return;
        const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });
        state.privateKeyPem = privateKey;
        state.publicKeyPem = publicKey;
        saveState();
    }

    function signBody(body) {
        const signer = crypto.createSign('sha256');
        signer.update(body);
        signer.end();
        return signer.sign(state.privateKeyPem, 'base64');
    }

    function unwrapResponse(payload) {
        const items = Array.isArray(payload?.Response) ? payload.Response : [];
        const merged = {};
        for (const item of items) {
            Object.assign(merged, item);
        }
        return { items, merged };
    }

    async function rawRequest(method, endpoint, { body = null, token = null, sign = false } = {}) {
        const bodyString = body == null ? '' : JSON.stringify(body);
        const headers = {
            'Cache-Control': 'no-cache',
            'User-Agent': 'PokeVault/1.0',
            'X-Bunq-Language': 'nl_NL',
            'X-Bunq-Region': 'nl_NL',
            'X-Bunq-Geolocation': '0 0 0 0 000',
            'X-Bunq-Client-Request-Id': crypto.randomBytes(16).toString('hex')
        };

        if (body != null) {
            headers['Content-Type'] = 'application/json';
        }
        if (token) {
            headers['X-Bunq-Client-Authentication'] = token;
        }
        if (sign) {
            ensureKeyPair();
            headers['X-Bunq-Client-Signature'] = signBody(bodyString);
        }

        const response = await fetch(`${baseUrl}${endpoint}`, {
            method,
            headers,
            body: body == null ? undefined : bodyString
        });

        const text = await response.text();
        let payload = null;
        try {
            payload = text ? JSON.parse(text) : null;
        } catch {
            payload = { raw: text };
        }

        if (!response.ok) {
            const message =
                payload?.Error?.[0]?.error_description ||
                payload?.error ||
                text ||
                `bunq HTTP ${response.status}`;
            const err = new Error(message);
            err.status = response.status;
            err.payload = payload;
            throw err;
        }

        return unwrapResponse(payload);
    }

    async function ensureInstallation() {
        ensureKeyPair();
        if (state.installationToken && state.serverPublicKey) return;

        const { merged } = await rawRequest('POST', '/installation', {
            body: { client_public_key: state.publicKeyPem },
            sign: false
        });

        const token = merged.Token?.token;
        const serverPublicKey = merged.ServerPublicKey?.server_public_key;
        if (!token || !serverPublicKey) {
            throw new Error('bunq installation mislukt: geen token of server key.');
        }

        state.installationToken = token;
        state.serverPublicKey = serverPublicKey;
        saveState();
    }

    async function ensureDevice() {
        await ensureInstallation();
        if (state.deviceRegistered) return;

        await rawRequest('POST', '/device-server', {
            body: {
                description: 'PokeVault webshop',
                secret: apiKey,
                permitted_ips: ['*']
            },
            token: state.installationToken,
            sign: true
        });

        state.deviceRegistered = true;
        saveState();
    }

    function extractUserId(merged) {
        return (
            merged.UserPerson?.id ||
            merged.UserCompany?.id ||
            merged.UserApiKey?.granted_by_user?.UserPerson?.id ||
            merged.UserApiKey?.granted_by_user?.UserCompany?.id ||
            merged.UserApiKey?.id ||
            null
        );
    }

    async function createSession() {
        await ensureDevice();

        const { merged } = await rawRequest('POST', '/session-server', {
            body: { secret: apiKey },
            token: state.installationToken,
            sign: true
        });

        const sessionToken = merged.Token?.token;
        const userId = extractUserId(merged);
        if (!sessionToken || !userId) {
            throw new Error('bunq sessie mislukt: geen session token of user id.');
        }

        state.sessionToken = sessionToken;
        state.userId = userId;
        state.sessionCreatedAt = Date.now();
        saveState();
        return { sessionToken, userId };
    }

    async function ensureSession() {
        if (state.sessionToken && state.userId) {
            const ageMs = Date.now() - (state.sessionCreatedAt || 0);
            // Sessions last up to ~1 week; refresh proactively after 6 days.
            if (ageMs < 6 * 24 * 60 * 60 * 1000) {
                return { sessionToken: state.sessionToken, userId: state.userId };
            }
        }

        if (!sessionPromise) {
            sessionPromise = createSession().finally(() => {
                sessionPromise = null;
            });
        }
        return sessionPromise;
    }

    async function api(method, endpoint, body = null) {
        const { sessionToken } = await ensureSession();
        try {
            return await rawRequest(method, endpoint, {
                body,
                token: sessionToken,
                sign: true
            });
        } catch (err) {
            if (err.status === 401 || /session/i.test(err.message || '')) {
                state.sessionToken = null;
                state.sessionCreatedAt = null;
                saveState();
                const session = await createSession();
                return rawRequest(method, endpoint, {
                    body,
                    token: session.sessionToken,
                    sign: true
                });
            }
            throw err;
        }
    }

    function monetaryAccountIdFromItem(item) {
        return (
            item.MonetaryAccountBank?.id ||
            item.MonetaryAccountJoint?.id ||
            item.MonetaryAccountLight?.id ||
            item.MonetaryAccountSavings?.id ||
            item.MonetaryAccountExternal?.id ||
            null
        );
    }

    function monetaryAccountStatusFromItem(item) {
        return (
            item.MonetaryAccountBank?.status ||
            item.MonetaryAccountJoint?.status ||
            item.MonetaryAccountLight?.status ||
            item.MonetaryAccountSavings?.status ||
            item.MonetaryAccountExternal?.status ||
            null
        );
    }

    async function resolveMonetaryAccountId() {
        if (monetaryAccountId) {
            state.monetaryAccountId = Number(monetaryAccountId);
            saveState();
            return state.monetaryAccountId;
        }
        if (state.monetaryAccountId) return state.monetaryAccountId;

        const { userId } = await ensureSession();
        const { items } = await api('GET', `/user/${userId}/monetary-account`);
        const active = items.find((item) => monetaryAccountStatusFromItem(item) === 'ACTIVE');
        const chosen = active || items[0];
        const id = monetaryAccountIdFromItem(chosen || {});
        if (!id) {
            throw new Error('Geen bunq monetary account gevonden.');
        }
        state.monetaryAccountId = id;
        saveState();
        return id;
    }

    async function createBunqMeTab({ amount, description, redirectUrl }) {
        const { userId } = await ensureSession();
        const accountId = await resolveMonetaryAccountId();
        const value = Number(amount).toFixed(2);

        const created = await api('POST', `/user/${userId}/monetary-account/${accountId}/bunqme-tab`, {
            bunqme_tab_entry: {
                amount_inquired: {
                    value,
                    currency: 'EUR'
                },
                description: String(description || 'PokeVault bestelling').slice(0, 140),
                redirect_url: redirectUrl
            }
        });

        const tabId = created.merged.Id?.id;
        if (!tabId) {
            throw new Error('bunq.me tab aanmaken mislukt: geen id.');
        }

        const tab = await getBunqMeTab(tabId);
        return tab;
    }

    async function getBunqMeTab(tabId) {
        const { userId } = await ensureSession();
        const accountId = await resolveMonetaryAccountId();
        const { merged } = await api(
            'GET',
            `/user/${userId}/monetary-account/${accountId}/bunqme-tab/${tabId}`
        );
        const tab = merged.BunqMeTab;
        if (!tab) {
            throw new Error(`bunq.me tab ${tabId} niet gevonden.`);
        }
        return {
            id: tab.id,
            status: tab.status,
            shareUrl: tab.bunqme_tab_share_url || null,
            timeExpiry: tab.time_expiry || null,
            resultInquiries: Array.isArray(tab.result_inquiries) ? tab.result_inquiries : [],
            raw: tab
        };
    }

    function isTabPaid(tab) {
        if (!tab) return false;
        if (tab.status === 'PAID') return true;
        const results = tab.resultInquiries || [];
        return results.length > 0;
    }

    return {
        createBunqMeTab,
        getBunqMeTab,
        isTabPaid,
        ensureSession
    };
}

module.exports = { createBunqClient };
