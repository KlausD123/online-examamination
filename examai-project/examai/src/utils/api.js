var API = 'https://online-examamination-production.up.railway.app/api';

function getToken() {
    return localStorage.getItem('examai_token');
}

function authHeaders() {
    var t = getToken();
    var h = { 'Content-Type': 'application/json' };
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
}

export async function apiGet(path) {
    var r = await fetch(API + path, { headers: authHeaders() });
    if (!r.ok) { var e = await r.json().catch(function() { return {}; }); throw new Error(e.error || 'Request failed'); }
    return r.json();
}

export async function apiPost(path, data) {
    var r = await fetch(API + path, { method: 'POST', headers: authHeaders(), body: JSON.stringify(data) });
    if (!r.ok) { var e = await r.json().catch(function() { return {}; }); throw new Error(e.error || 'Request failed'); }
    return r.json();
}

export async function apiPut(path, data) {
    var r = await fetch(API + path, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(data) });
    if (!r.ok) { var e = await r.json().catch(function() { return {}; }); throw new Error(e.error || 'Request failed'); }
    return r.json();
}

export async function apiDelete(path) {
    var r = await fetch(API + path, { method: 'DELETE', headers: authHeaders() });
    if (!r.ok) { var e = await r.json().catch(function() { return {}; }); throw new Error(e.error || 'Request failed'); }
    return r.json();
}