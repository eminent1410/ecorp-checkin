const { syncCheckins } = require('./sync-checkins-core');

exports.handler = async () => {
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
