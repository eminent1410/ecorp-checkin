const { syncCheckins } = require('./sync-checkins-core');

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

    const result = await syncCheckins();
    return json(200, result);
  } catch (error) {
    console.error('sync-checkins-manual error:', error);
    return json(500, {
      success: false,
      message: error?.message || 'Lỗi đồng bộ check-in.'
    });
  }
};

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
