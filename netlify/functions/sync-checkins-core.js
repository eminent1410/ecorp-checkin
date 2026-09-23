/**
 * ECORP Check-in
 * Core: Supabase checkins -> Google Sheet CHECKIN
 *
 * Google Sheet CHECKIN columns (A:J):
 * A Timestamp
 * B Email
 * C Latitude
 * D Longitude
 * E Accuracy
 * F Ảnh
 * G Cảm xúc
 * H Lý do
 * I Đi khảo sát
 * J CheckinId
 */

const SHEET_NAME = 'CHECKIN';
const CHECKPOINT_CREATED_AT = 'checkins_google_sheet_last_created_at';
const CHECKPOINT_ID = 'checkins_google_sheet_last_id';
const BATCH_SIZE = 500;

async function syncCheckins() {
  const sheetId = requiredEnv('GOOGLE_SHEET_ID');
  const serviceAccount = parseServiceAccount();
  const accessToken = await getGoogleAccessToken(serviceAccount);

  const checkpoint = await getCheckpoint();
  const rows = await readNewCheckins(checkpoint);

  if (!rows.length) {
    return {
      success: true,
      message: 'Không có check-in mới để đồng bộ.',
      found: 0,
      appended: 0,
      checkpoint
    };
  }

  const values = rows.map(toSheetRow);
  await appendToSheet(accessToken, sheetId, values);

  const last = rows[rows.length - 1];
  await updateCheckpoint(last.created_at, last.id);

  return {
    success: true,
    message: 'Đồng bộ check-in thành công.',
    found: rows.length,
    appended: values.length,
    previousCheckpoint: checkpoint,
    newCheckpoint: {
      created_at: last.created_at,
      id: last.id
    },
    hasMore: rows.length >= BATCH_SIZE
  };
}

async function readNewCheckins(checkpoint) {
  const lastCreatedAt = String(checkpoint.created_at || '1970-01-01T00:00:00.000Z');
  const lastId = String(checkpoint.id || '').trim();

  const select = [
    'id',
    'checkin_id',
    'email',
    'timestamp',
    'latitude',
    'longitude',
    'accuracy',
    'photo_path',
    'emotion',
    'emotion_reason',
    'survey',
    'created_at'
  ].join(',');

  let filter;
  if (!lastId) {
    filter = `created_at=gt.${lastCreatedAt}`;
  } else {
    filter = `or=(created_at.gt.${lastCreatedAt},and(created_at.eq.${lastCreatedAt},id.gt.${lastId}))`;
  }

  // Construct the PostgREST filter explicitly.
  const query = new URLSearchParams({
    select,
    order: 'created_at.asc,id.asc',
    limit: String(BATCH_SIZE)
  });

  const filterUrl = lastId
    ? `or=(created_at.gt.${encodeURIComponent(lastCreatedAt)},and(created_at.eq.${encodeURIComponent(lastCreatedAt)},id.gt.${encodeURIComponent(lastId)}))`
    : `created_at=gt.${encodeURIComponent(lastCreatedAt)}`;

  const data = await supabaseRequest(`/rest/v1/checkins?${query.toString()}&${filterUrl}`);
  return Array.isArray(data) ? data : [];
}

function toSheetRow(row) {
  return [
    formatVietnamDateTime(row.timestamp),
    row.email ?? '',
    row.latitude ?? '',
    row.longitude ?? '',
    row.accuracy ?? '',
    publicPhotoUrl(row.photo_path),
    row.emotion ?? '',
    row.emotion_reason ?? '',
    row.survey === true ? 'x' : '',
    row.checkin_id ?? ''
  ];
}


function formatVietnamDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.day}/${map.month}/${map.year} ${map.hour}:${map.minute}:${map.second}`;
}

function publicPhotoUrl(photoPath) {
  if (!photoPath) return '';
  const baseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  return `${baseUrl}/storage/v1/object/public/checkin-photos/${String(photoPath).split('/').map(encodeURIComponent).join('/')}`;
}

async function appendToSheet(accessToken, sheetId, values) {
  if (!values.length) return null;

  // IMPORTANT:
  // Do NOT use values.append + INSERT_ROWS here.
  // The production CHECKIN sheet has formulas/ARRAYFORMULA in columns K+.
  // We only write A:J into existing/new rows without inserting rows.
  const startRow = await findNextWriteRow(accessToken, sheetId);
  const endRow = startRow + values.length - 1;
  const range = `${SHEET_NAME}!A${startRow}:J${endRow}`;

  // A direct values.update does not create new grid rows. If the sheet has
  // reached its current row limit, expand the grid first. This only adds
  // empty grid rows; it does NOT insert/move any existing rows, so K+ and
  // their ARRAYFORMULA remain untouched.
  await ensureSheetRows(accessToken, sheetId, endRow);

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      range,
      majorDimension: 'ROWS',
      values
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Google Sheets lỗi khi ghi CHECKIN: ${data.error?.message || 'không ghi được dữ liệu'}`);
  }

  return data;
}

async function ensureSheetRows(accessToken, sheetId, requiredRow) {
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))`;

  const metaResponse = await fetch(metaUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const meta = await metaResponse.json();
  if (!metaResponse.ok) {
    throw new Error(`Google Sheets lỗi khi đọc cấu hình CHECKIN: ${meta.error?.message || 'không đọc được cấu hình sheet'}`);
  }

  const sheet = meta.sheets?.find(s => s.properties?.title === SHEET_NAME);
  if (!sheet) {
    throw new Error(`Không tìm thấy sheet ${SHEET_NAME}`);
  }

  const sheetNumericId = sheet.properties.sheetId;
  const currentRowCount = Number(sheet.properties.gridProperties?.rowCount || 0);

  if (requiredRow <= currentRowCount) return;

  // Add a little headroom so the next few check-ins do not immediately need
  // another grid expansion. appendDimension expands the grid only; it does
  // not insert data rows or move any existing content/formulas.
  const rowsToAdd = Math.max(requiredRow - currentRowCount, 20);
  const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}:batchUpdate`;

  const response = await fetch(batchUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [{
        appendDimension: {
          sheetId: sheetNumericId,
          dimension: 'ROWS',
          length: rowsToAdd
        }
      }]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Google Sheets lỗi khi mở rộng số dòng CHECKIN: ${data.error?.message || 'không thể mở rộng sheet'}`);
  }
}

async function findNextWriteRow(accessToken, sheetId) {
  // Read only column A. This does not modify the sheet and lets us find
  // the first row after the existing CHECKIN data without inserting rows.
  const range = `${SHEET_NAME}!A:A`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?majorDimension=COLUMNS`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Google Sheets lỗi khi đọc CHECKIN: ${data.error?.message || 'không đọc được dữ liệu'}`);
  }

  const columnA = Array.isArray(data.values?.[0]) ? data.values[0] : [];

  // Row 1 is the header. The next row after the last non-empty Timestamp
  // is the write target. No row is inserted, so K+ remains untouched.
  let lastNonEmptyRow = 1;
  for (let i = columnA.length - 1; i >= 1; i--) {
    if (String(columnA[i] ?? '').trim() !== '') {
      lastNonEmptyRow = i + 1;
      break;
    }
  }

  return lastNonEmptyRow + 1;
}

async function getCheckpoint() {
  const keys = `${CHECKPOINT_CREATED_AT},${CHECKPOINT_ID}`;
  const data = await supabaseRequest(
    `/rest/v1/sync_state?key=in.(${encodeURIComponent(keys)})&select=key,value`
  );

  const map = Object.fromEntries((Array.isArray(data) ? data : []).map(row => [row.key, row.value]));
  return {
    created_at: map[CHECKPOINT_CREATED_AT] || '1970-01-01T00:00:00.000Z',
    id: map[CHECKPOINT_ID] || ''
  };
}

async function updateCheckpoint(createdAt, id) {
  const now = new Date().toISOString();

  await supabaseRequest('/rest/v1/sync_state?on_conflict=key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([
      { key: CHECKPOINT_CREATED_AT, value: createdAt, updated_at: now },
      { key: CHECKPOINT_ID, value: id, updated_at: now }
    ])
  });
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
    scope: 'https://www.googleapis.com/auth/spreadsheets',
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

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Thiếu ${name}.`);
  return value;
}

function base64url(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

module.exports = { syncCheckins };
