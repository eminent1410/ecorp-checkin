const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'GET' && event.queryStringParameters?.config === '1') {
    const googleClientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
    if (!googleClientId) {
      return json(503, { success: false, message: 'Netlify chưa cấu hình GOOGLE_CLIENT_ID.' });
    }
    return json(200, { success: true, googleClientId });
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, message: 'Method không được hỗ trợ.' });
  }

  const appsScriptUrl = String(process.env.APPS_SCRIPT_URL || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(appsScriptUrl)) {
    return json(503, { success: false, message: 'Netlify chưa cấu hình URL /exec của Apps Script.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { success: false, message: 'Dữ liệu gửi lên không hợp lệ.' });
  }

  if (!['getCurrentUser', 'submitCheckin'].includes(body?.action) ||
      typeof body.idToken !== 'string' || !body.idToken.trim() ||
      (body.action === 'submitCheckin' && (!body.data || typeof body.data !== 'object'))) {
    return json(400, { success: false, message: 'Thiếu thông tin xác thực hoặc dữ liệu điểm danh.' });
  }

  try {
    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25_000)
    });

    if (!response.ok) throw new Error('Apps Script HTTP ' + response.status);
    const result = await response.json();
    if (typeof result?.success !== 'boolean') throw new Error('Invalid Apps Script response');

    return json(result.success ? 200 : 422, result);
  } catch {
    return json(502, {
      success: false,
      message: 'Không nhận được phản hồi từ Apps Script. Vui lòng thử lại.'
    });
  }
};

function json(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}
