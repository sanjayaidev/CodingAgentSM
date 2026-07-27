function normalizeBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function resolveBaseUrl({ appBaseUrl = '', railwayPublicDomain = '', req } = {}) {
  const explicitBaseUrl = normalizeBaseUrl(appBaseUrl);
  if (explicitBaseUrl) return explicitBaseUrl;

  const railwayUrl = normalizeBaseUrl(railwayPublicDomain ? `https://${railwayPublicDomain}` : '');
  if (railwayUrl) return railwayUrl;

  if (req) {
    const forwardedProto = (req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim();
    const protocol = forwardedProto || req.protocol || 'http';
    const host = req.get ? req.get('host') : req.headers.host;
    if (host) return `${protocol}://${host}`;
  }

  return '';
}

module.exports = {
  normalizeBaseUrl,
  resolveBaseUrl,
};
