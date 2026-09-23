/**
 * ECORP Check-in
 * Sync Google Sheet "NHÂN VIÊN" -> Supabase employees
 *
 * Google Sheet columns (A:E):
 * A = Name
 * B = Department
 * C = Phone
 * D = Employee ID
 * E = Email
 *
 * Manual test:
 * /.netlify/functions/sync-employees?secret=YOUR_SYNC_SECRET
 *
 * Required Netlify environment variables:
 * SUPABASE_URL
 * SUPABASE_SECRET_KEY   (Supabase Secret key: sb_secret_...)
 * GOOGLE_SERVICE_ACCOUNT_JSON
 * SYNC_SECRET
 * GOOGLE_SHEET_ID
 */

const SHEET_NAME = 'NHÂN VIÊN';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return response(204, '');
  }

  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return json(405, { success: false, message: 'Method không được hỗ trợ.' });
  }

  try {
    const suppliedSecret = String(
      event.queryStringParameters?.secret ||
      event.headers?.['x-sync-secret'] ||
      ''
    );

    const syncSecret = String(process.env.SYNC_SECRET || '');
    if (!syncSecret || suppliedSecret !== syncSecret) {
      return json(401, { success: false, message: 'Không được phép.' });
    }

    const sheetId = String(process.env.GOOGLE_SHEET_ID || '').trim();
    if (!sheetId) throw new Error('Thiếu GOOGLE_SHEET_ID.');

    const serviceAccount = parseServiceAccount();
    const accessToken = await getGoogleAccessToken(serviceAccount);
    const rows = await readEmployees(accessToken, sheetId);

    const employees = normalizeEmployees(rows);
    if (!employees.length) {
      return json(200, {
        success: true,
        message: 'Không có nhân viên hợp lệ để đồng bộ.',
        sheetRows: rows.length,
        synced: 0
      });
    }

    const upsertResult = await upsertEmployees(employees);

    // Important: only deactivate existing employees when the sheet was read
    // successfully. This keeps the source of truth as the NHÂN VIÊN sheet.
    const activeEmails = employees.map(e => e.email);
    const deactivated = await deactivateMissingEmployees(activeEmails);

    return json(200, {
      success: true,
      message: 'Đồng bộ danh sách nhân viên thành công.',
      sheetRows: rows.length,
      validEmployees: employees.length,
      upserted: upsertResult.count,
      deactivated
    });
  } catch (error) {
    console.error('sync-employees error:', error);
    return json(500, {
      success: false,
      message: error?.message || 'Lỗi đồng bộ danh sách nhân viên.'
    });
  }
};

function parseServiceAccount() {
  const raw = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) throw new Error('Thiếu GOOGLE_SERVICE_ACCOUNT_JSON.');

  try {
    const account = JSON.parse(raw);
    if (!account.client_email || !account.private_key) {
      throw new Error('Service Account JSON thiếu client_email hoặc private_key.');
    }
    return account;
  } catch (error) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON không hợp lệ: ' + error.message);
  }
}

async function getGoogleAccessToken(account) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));

  const unsigned = `${header}.${payload}`;
  const signer = require('crypto').createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(account.private_key);
  const assertion = `${unsigned}.${base64url(signature)}`;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  const data = await tokenResponse.json();
  if (!tokenResponse.ok || !data.access_token) {
    throw new Error(`Google OAuth lỗi: ${data.error_description || data.error || 'không lấy được access token'}`);
  }

  return data.access_token;
}

async function readEmployees(accessToken, sheetId) {
  const range = encodeURIComponent(`${SHEET_NAME}!A:E`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${range}?majorDimension=ROWS`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Google Sheets lỗi: ${data.error?.message || 'không đọc được sheet'}`);
  }

  // First row is the header row.
  return Array.isArray(data.values) ? data.values.slice(1) : [];
}

function normalizeEmployees(rows) {
  const seen = new Set();
  const result = [];

  for (const row of rows) {
    const name = String(row?.[0] ?? '').trim();
    const department = String(row?.[1] ?? '').trim();
    const phone = String(row?.[2] ?? '').trim();
    const employeeId = String(row?.[3] ?? '').trim();
    const email = String(row?.[4] ?? '').trim().toLowerCase();

    if (!email || !email.includes('@')) continue;
    if (seen.has(email)) continue;
    seen.add(email);

    result.push({
      employee_id: employeeId,
      name,
      department,
      phone,
      email,
      active: true,
      updated_at: new Date().toISOString()
    });
  }

  return result;
}

async function supabaseRequest(path, options = {}) {
  const baseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const secretKey = String(process.env.SUPABASE_SECRET_KEY || '').trim();

  if (!baseUrl) throw new Error('Thiếu SUPABASE_URL.');
  if (!secretKey) throw new Error('Thiếu SUPABASE_SECRET_KEY.');

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) {}

  if (!response.ok) {
    throw new Error(`Supabase lỗi ${response.status}: ${data?.message || data?.hint || text || 'unknown error'}`);
  }

  return data;
}

async function upsertEmployees(employees) {
  await supabaseRequest('/rest/v1/employees?on_conflict=email', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(employees)
  });

  return { count: employees.length };
}

async function deactivateMissingEmployees(activeEmails) {
  // Do not issue a broad destructive operation when the sheet has no valid rows.
  if (!activeEmails.length) return 0;

  const encoded = activeEmails.map(email => `"${email.replace(/"/g, '\\"')}"`).join(',');
  const data = await supabaseRequest(
    `/rest/v1/employees?email=not.in.(${encodeURIComponent(`(${encoded})`)})&active=eq.true`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ active: false, updated_at: new Date().toISOString() })
    }
  );

  return Array.isArray(data) ? data.length : 0;
}

function base64url(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function json(statusCode, body) {
  return response(statusCode, JSON.stringify(body), true);
}

function response(statusCode, body, isJson = false) {
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Secret',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      ...(isJson ? { 'Content-Type': 'application/json; charset=utf-8' } : {})
    },
    body
  };
}
