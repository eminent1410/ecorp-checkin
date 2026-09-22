// ECORP Check-in - Netlify Function
// Frontend configuration only. Check-in data is handled directly by Supabase.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return json(405, { success: false, message: 'Method không được hỗ trợ.' });
  }

  if (event.queryStringParameters?.config === '1') {
    const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
    const supabasePublishableKey = String(
      process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || ''
    ).trim();

    if (!supabaseUrl || !supabasePublishableKey) {
      return json(500, {
        success: false,
        message: 'Netlify chưa cấu hình SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY.'
      });
    }

    return json(200, {
      success: true,
      supabaseUrl,
      supabasePublishableKey
    });
  }

  return json(404, { success: false, message: 'Không tìm thấy endpoint.' });
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body)
  };
}
