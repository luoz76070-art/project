const test = require('node:test');
const assert = require('node:assert/strict');

const rows = require('./fixtures/raw-source-rows.json');
const { CSV_HEADERS, normalizeRowsToRecords } = require('../scripts/normalize-records');

test('normalizeRowsToRecords emits the fixed header order', () => {
  assert.deepEqual(CSV_HEADERS, [
    'record_id', 'snapshot_date', 'company_name', 'batch', 'company_type', 'industry',
    'target_candidates', 'job_title_raw', 'job_status_raw', 'location_raw', 'updated_at_raw',
    'deadline_raw', 'official_notice_text', 'apply_text', 'remark_raw', 'official_notice_url',
    'apply_url', 'job_keywords', 'major_keywords', 'location_tokens', 'degree_level',
    'is_closed', 'is_expired', 'deadline_date', 'updated_date', 'source_url', 'extracted_at'
  ]);
});

test('normalizeRowsToRecords creates one stable record per source row', () => {
  const result = normalizeRowsToRecords(rows, {
    snapshotDate: '2026-03-24',
    extractedAt: '2026-03-24T10:00:00.000Z',
    sourceUrl: 'https://docs.qq.com/sheet/demo'
  });

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].company_name, '南方电网');
  assert.equal(result.records[0].job_keywords, '电气类业务');
  assert.equal(result.records[0].major_keywords, '电气类');
  assert.equal(result.records[0].location_tokens, '广东');
  assert.equal(result.records[0].is_closed, 'false');
  assert.equal(result.records[0].is_expired, 'false');
  assert.equal(result.records[0].updated_date, '2026-03-13');
  assert.equal(result.records[0].deadline_date, '2026-03-25');
  assert.equal(result.records[0].degree_level, '本科');
  assert.match(result.records[0].record_id, /^[a-f0-9]{64}$/);
});

test('normalizeRowsToRecords rejects same-snapshot record_id collisions', () => {
  try {
    normalizeRowsToRecords([rows[0], rows[1], rows[1]], {
      snapshotDate: '2026-03-24',
      extractedAt: '2026-03-24T10:00:00.000Z',
      sourceUrl: 'https://docs.qq.com/sheet/demo'
    });
    assert.fail('expected collision');
  } catch (error) {
    assert.match(error.message, /record_id collision/);
    assert.equal(error.collisionSample.conflictingRows.length, 2);
  }
});

test('normalizeRowsToRecords fails loudly when required columns are missing', () => {
  assert.throws(() => normalizeRowsToRecords([
    ['公司名称', '招聘岗位'],
    ['南方电网', '电气类业务']
  ], {
    snapshotDate: '2026-03-24',
    extractedAt: '2026-03-24T10:00:00.000Z',
    sourceUrl: 'https://docs.qq.com/sheet/demo'
  }), /missing required columns: 工作地点, 更新时间, 截止时间/);
});
