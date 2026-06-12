// ─── Generate OTP Script ──────────────────────────────────────────────────────
// KEYS[1]  rateLimit:minute key  (caller must include prefix)
// KEYS[2]  rateLimit:hour key
// KEYS[3]  rateLimit:day key
// KEYS[4]  otp:code key
// KEYS[5]  otp:attempts key
// ARGV[1]  new OTP code (string)
// ARGV[2]  rate limit per minute
// ARGV[3]  rate limit per hour
// ARGV[4]  rate limit per day
// ARGV[5]  OTP TTL in seconds
export const generateOtpScript = `
local minute_count = tonumber(redis.call('GET', KEYS[1])) or 0
local hour_count   = tonumber(redis.call('GET', KEYS[2])) or 0
local day_count    = tonumber(redis.call('GET', KEYS[3])) or 0

if minute_count >= tonumber(ARGV[2]) then
  local ttl = redis.call('TTL', KEYS[1])
  return { 'RATE_LIMITED', 'minute', tostring(ttl) }
end
if hour_count >= tonumber(ARGV[3]) then
  local ttl = redis.call('TTL', KEYS[2])
  return { 'RATE_LIMITED', 'hour', tostring(ttl) }
end
if day_count >= tonumber(ARGV[4]) then
  local ttl = redis.call('TTL', KEYS[3])
  return { 'RATE_LIMITED', 'day', tostring(ttl) }
end

redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], 60, 'NX')
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], 3600, 'NX')
redis.call('INCR', KEYS[3])
redis.call('EXPIRE', KEYS[3], 86400, 'NX')

redis.call('SET', KEYS[4], ARGV[1], 'EX', tonumber(ARGV[5]))
redis.call('SET', KEYS[5], '0',     'EX', tonumber(ARGV[5]))

return { 'OK' }
`;

// ─── Verify OTP Script ────────────────────────────────────────────────────────
// KEYS[1]  otp:code key      (caller must include prefix)
// KEYS[2]  otp:attempts key
// ARGV[1]  candidate code (string)
// ARGV[2]  max attempts (number)
export const verifyOtpScript = `
local stored = redis.call('GET', KEYS[1])
if not stored then
  return 'OTP_NOT_FOUND'
end

local attempts = tonumber(redis.call('GET', KEYS[2])) or 0
if attempts >= tonumber(ARGV[2]) then
  return 'MAX_ATTEMPTS_EXCEEDED'
end

redis.call('INCR', KEYS[2])

if stored ~= ARGV[1] then
  return 'INVALID_CODE'
end

redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
return 'OK'
`;
