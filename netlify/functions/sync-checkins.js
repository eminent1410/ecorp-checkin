const { syncCheckins } = require('./sync-checkins-core');

exports.handler = async () => {
  if (process.env.ENABLE_SUPABASE_SYNC !== 'true') {
    return { statusCode: 404, body: '' };
  }

  try {
    const result = await syncCheckins();
    console.log('sync-checkins:', result);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error) {
    console.error('sync-checkins error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: error?.message || 'Lỗi đồng bộ check-in.' })
    };
  }
};
