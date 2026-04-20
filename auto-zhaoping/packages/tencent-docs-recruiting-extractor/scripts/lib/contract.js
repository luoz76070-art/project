const crypto = require('node:crypto');

const CSV_HEADERS = [
  'record_id', 'snapshot_date', 'company_name', 'batch', 'company_type', 'industry',
  'target_candidates', 'job_title_raw', 'job_status_raw', 'location_raw', 'updated_at_raw',
  'deadline_raw', 'official_notice_text', 'apply_text', 'remark_raw', 'official_notice_url',
  'apply_url', 'job_keywords', 'major_keywords', 'location_tokens', 'degree_level',
  'is_closed', 'is_expired', 'deadline_date', 'updated_date', 'source_url', 'extracted_at'
];

function normalizeIdentityValue(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/[，。；;、,.!?]+$/g, '')
    .trim()
    .toLowerCase();
}

function buildRecordId(record) {
  const baseKey = [
    normalizeIdentityValue(record.company_name),
    normalizeIdentityValue(record.job_title_raw),
    normalizeIdentityValue(record.location_raw),
    normalizeIdentityValue(record.deadline_date || record.deadline_raw),
    normalizeIdentityValue(record.apply_url || record.official_notice_url),
    normalizeIdentityValue(record.official_notice_text)
  ].join('||');

  return crypto.createHash('sha256').update(baseKey).digest('hex');
}

module.exports = {
  buildRecordId,
  CSV_HEADERS,
  normalizeIdentityValue,
};
