const { buildRecordId, CSV_HEADERS } = require('./lib/contract');

const REQUIRED_HEADERS = ['公司名称', '招聘岗位', '工作地点', '更新时间', '截止时间'];

function parseDate(raw) {
  const normalized = String(raw || '').trim().replace(/[./]/g, '-');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return '';
  }

  return normalized;
}

function uniqueTokens(values) {
  return [...new Set(values.filter(Boolean))];
}

function tokenizeText(raw) {
  return uniqueTokens(
    String(raw || '')
      .split(/[\s,，/；;、|]+/)
      .map((value) => value.trim())
  );
}

function extractJobKeywords(raw) {
  return tokenizeText(raw).join('|');
}

function extractMajorKeywords(...texts) {
  const matches = texts.flatMap((text) => String(text || '').match(/[A-Za-z\u4e00-\u9fa5]+(?:专业|类|方向)/g) || []);
  return uniqueTokens(matches).join('|');
}

function splitLocationTokens(raw) {
  return tokenizeText(raw).join('|');
}

function deriveDegreeLevel(raw) {
  const text = String(raw || '').trim();
  const levels = [
    ['博士', /博士/],
    ['硕士', /硕士/],
    ['本科', /本科/],
    ['专科', /大专|专科/],
    ['不限', /不限/],
  ]
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);

  if (levels.length > 0) {
    return levels.join('|');
  }

  return text;
}

function getCell(row, indexMap, headerName) {
  return row[indexMap[headerName]] || '';
}

function buildHeaderIndex(headerRow) {
  return Object.fromEntries(headerRow.map((name, index) => [name, index]));
}

function normalizeRowsToRecords(rows, meta) {
  const [headerRow = [], ...dataRows] = rows;
  const indexMap = buildHeaderIndex(headerRow);
  const missingHeaders = REQUIRED_HEADERS.filter((name) => !(name in indexMap));

  if (missingHeaders.length > 0) {
    throw new Error(`missing required columns: ${missingHeaders.join(', ')}`);
  }

  const recordIdToRows = new Map();
  const records = dataRows.map((row) => {
    const updatedDate = parseDate(getCell(row, indexMap, '更新时间'));
    const deadlineDate = parseDate(getCell(row, indexMap, '截止时间'));
    const record = {
      record_id: '',
      snapshot_date: meta.snapshotDate,
      company_name: getCell(row, indexMap, '公司名称'),
      batch: getCell(row, indexMap, '批次'),
      company_type: getCell(row, indexMap, '企业性质'),
      industry: getCell(row, indexMap, '行业大类'),
      target_candidates: getCell(row, indexMap, '招聘对象'),
      job_title_raw: getCell(row, indexMap, '招聘岗位'),
      job_status_raw: getCell(row, indexMap, '网申状态'),
      location_raw: getCell(row, indexMap, '工作地点'),
      updated_at_raw: getCell(row, indexMap, '更新时间'),
      deadline_raw: getCell(row, indexMap, '截止时间'),
      official_notice_text: getCell(row, indexMap, '官方公告'),
      apply_text: getCell(row, indexMap, '投递方式'),
      remark_raw: getCell(row, indexMap, '内推码/备注'),
      official_notice_url: getCell(row, indexMap, '官方公告_URL'),
      apply_url: getCell(row, indexMap, '投递方式_URL'),
      job_keywords: extractJobKeywords(getCell(row, indexMap, '招聘岗位')),
      major_keywords: extractMajorKeywords(
        getCell(row, indexMap, '招聘岗位'),
        getCell(row, indexMap, '招聘对象'),
        getCell(row, indexMap, '内推码/备注')
      ),
      location_tokens: splitLocationTokens(getCell(row, indexMap, '工作地点')),
      degree_level: deriveDegreeLevel(getCell(row, indexMap, '招聘对象')),
      is_closed: /招满|已结束/.test(getCell(row, indexMap, '网申状态')) ? 'true' : 'false',
      is_expired: deadlineDate && deadlineDate < meta.snapshotDate ? 'true' : 'false',
      deadline_date: deadlineDate,
      updated_date: updatedDate,
      source_url: meta.sourceUrl,
      extracted_at: meta.extractedAt,
    };

    record.record_id = buildRecordId(record);

    if (recordIdToRows.has(record.record_id)) {
      const error = new Error(`record_id collision: ${record.record_id}`);
      error.collisionSample = {
        recordId: record.record_id,
        conflictingRows: [...recordIdToRows.get(record.record_id), row],
      };
      throw error;
    }

    recordIdToRows.set(record.record_id, [row]);
    return record;
  });

  return { headers: CSV_HEADERS, records };
}

module.exports = {
  CSV_HEADERS,
  deriveDegreeLevel,
  extractJobKeywords,
  extractMajorKeywords,
  normalizeRowsToRecords,
  parseDate,
  splitLocationTokens,
};
