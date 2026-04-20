# URL Markdown Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight phase-one path that accepts a webpage URL, fetches markdown content, extracts recruiting fields, and emits CSV fully compatible with the current phase-two contract.

**Architecture:** Keep the existing Tencent Docs extraction path unchanged. Build the new URL path as a narrow parallel path: markdown fetch adapter, markdown field extractor, URL record normalizer, and only then wire that path into the existing phase-one entrypoint.

**Tech Stack:** Node.js, CommonJS, existing extractor package, node:test, markdown-based parsing

---

## File Structure

- Modify: `packages/tencent-docs-recruiting-extractor/scripts/extract-once.js` - existing phase-one entrypoint, add a URL-only branch without changing the Tencent Docs branch
- Modify: `packages/tencent-docs-recruiting-extractor/scripts/lib/config.js` - allow a direct `url` input alongside the existing Tencent Docs config path
- Modify: `packages/tencent-docs-recruiting-extractor/README.md` - document the new URL path and its scope limits
- Create: `packages/tencent-docs-recruiting-extractor/scripts/lib/url-markdown-fetcher.js` - thin wrapper around the markdown-fetch provider
- Create: `packages/tencent-docs-recruiting-extractor/scripts/lib/markdown-recruiting-extractor.js` - extracts a first-pass recruiting field set from markdown text
- Create: `packages/tencent-docs-recruiting-extractor/scripts/lib/url-record-normalizer.js` - maps extracted URL fields into the current fixed CSV contract
- Modify: `packages/tencent-docs-recruiting-extractor/tests/config.test.js`
- Modify: `packages/tencent-docs-recruiting-extractor/tests/extract-once.test.js`
- Modify: `packages/tencent-docs-recruiting-extractor/tests/contract.test.js`
- Create: `packages/tencent-docs-recruiting-extractor/tests/url-markdown-fetcher.test.js`
- Create: `packages/tencent-docs-recruiting-extractor/tests/markdown-recruiting-extractor.test.js`
- Create: `packages/tencent-docs-recruiting-extractor/tests/url-record-normalizer.test.js`

### Task 1: Add URL Markdown Fetch Adapter

**Files:**
- Create: `packages/tencent-docs-recruiting-extractor/scripts/lib/url-markdown-fetcher.js`
- Test: `packages/tencent-docs-recruiting-extractor/tests/url-markdown-fetcher.test.js`

- [ ] **Step 1: Write the failing fetch adapter test**

```js
test('fetchUrlAsMarkdown returns source url, title, markdown content, and fetched timestamp', async () => {
  const result = await fetchUrlAsMarkdown('https://example.edu/jobs/123', {
    fetchProvider: async () => ({
      title: '校园招聘公告',
      markdownContent: '# 公告\n\n某公司招聘研发工程师',
      htmlSnapshotPath: '/tmp/source-captured.html',
    }),
  })

  assert.equal(result.sourceUrl, 'https://example.edu/jobs/123')
  assert.equal(result.title, '校园招聘公告')
  assert.match(result.markdownContent, /某公司招聘研发工程师/)
  assert.equal(result.htmlSnapshotPath, '/tmp/source-captured.html')
  assert.ok(result.fetchedAt)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @zhaoping/tencent-docs-recruiting-extractor test -- tests/url-markdown-fetcher.test.js`
Expected: FAIL because the fetch adapter does not exist yet.

- [ ] **Step 3: Implement the minimal fetch adapter**

```js
async function fetchUrlAsMarkdown(url, { fetchProvider }) {
  const output = await fetchProvider(url)

  return {
    sourceUrl: url,
    title: output.title || '',
    markdownContent: output.markdownContent || '',
    htmlSnapshotPath: output.htmlSnapshotPath || '',
    fetchedAt: new Date().toISOString(),
  }
}

module.exports = { fetchUrlAsMarkdown }
```

- [ ] **Step 4: Re-run the fetch adapter test**

Run: `npm --workspace @zhaoping/tencent-docs-recruiting-extractor test -- tests/url-markdown-fetcher.test.js`
Expected: PASS

### Task 2: Add Markdown Recruiting Field Extraction

**Files:**
- Create: `packages/tencent-docs-recruiting-extractor/scripts/lib/markdown-recruiting-extractor.js`
- Test: `packages/tencent-docs-recruiting-extractor/tests/markdown-recruiting-extractor.test.js`

- [ ] **Step 1: Write the failing extraction test**

```js
test('extractRecruitingFields pulls key recruiting fields from markdown text', () => {
  const result = extractRecruitingFields({
    sourceUrl: 'https://example.edu/jobs/123',
    title: 'XX大学就业网',
    markdownContent: [
      '# 某科技公司 2026 校园招聘',
      '招聘岗位：研发工程师',
      '工作地点：上海',
      '截止时间：2026-10-31',
      '投递链接：https://jobs.example.com/apply',
    ].join('\n'),
  })

  assert.equal(result.companyName, '某科技公司')
  assert.equal(result.jobTitleRaw, '研发工程师')
  assert.equal(result.locationRaw, '上海')
  assert.equal(result.deadlineRaw, '2026-10-31')
  assert.equal(result.applyUrl, 'https://jobs.example.com/apply')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @zhaoping/tencent-docs-recruiting-extractor test -- tests/markdown-recruiting-extractor.test.js`
Expected: FAIL because the extractor does not exist yet.

- [ ] **Step 3: Implement minimal markdown extraction logic**

```js
function pickFirstMatch(markdown, pattern) {
  const match = markdown.match(pattern)
  return match ? match[1].trim() : ''
}

function extractRecruitingFields(document) {
  const markdown = document.markdownContent || ''
  const heading = pickFirstMatch(markdown, /^#\s+(.+)$/m)

  return {
    sourceUrl: document.sourceUrl,
    title: document.title || '',
    companyName: heading.replace(/\s*202\d.*$/, '').trim(),
    jobTitleRaw: pickFirstMatch(markdown, /招聘岗位[:：]\s*(.+)/),
    locationRaw: pickFirstMatch(markdown, /工作地点[:：]\s*(.+)/),
    deadlineRaw: pickFirstMatch(markdown, /截止时间[:：]\s*(.+)/),
    applyUrl: pickFirstMatch(markdown, /投递链接[:：]\s*(https?:\/\/\S+)/),
  }
}

module.exports = { extractRecruitingFields }
```

- [ ] **Step 4: Re-run the extraction test**

Run: `npm --workspace @zhaoping/tencent-docs-recruiting-extractor test -- tests/markdown-recruiting-extractor.test.js`
Expected: PASS

### Task 3: Normalize Extracted Fields Into The Current CSV Contract

**Files:**
- Create: `packages/tencent-docs-recruiting-extractor/scripts/lib/url-record-normalizer.js`
- Test: `packages/tencent-docs-recruiting-extractor/tests/url-record-normalizer.test.js`

- [ ] **Step 1: Write the failing normalization test**

```js
test('normalizeUrlFieldsToRecord produces a phase-two compatible recruiting row', () => {
  const record = normalizeUrlFieldsToRecord({
    snapshotDate: '2026-04-09',
    extractedAt: '2026-04-09T10:00:00.000Z',
    sourceUrl: 'https://example.edu/jobs/123',
    companyName: '某科技公司',
    jobTitleRaw: '研发工程师',
    locationRaw: '上海',
    deadlineRaw: '2026-10-31',
    applyUrl: 'https://jobs.example.com/apply',
  })

  assert.equal(record.snapshot_date, '2026-04-09')
  assert.equal(record.company_name, '某科技公司')
  assert.equal(record.job_title_raw, '研发工程师')
  assert.equal(record.location_raw, '上海')
  assert.equal(record.deadline_raw, '2026-10-31')
  assert.equal(record.apply_url, 'https://jobs.example.com/apply')
  assert.equal(record.source_url, 'https://example.edu/jobs/123')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @zhaoping/tencent-docs-recruiting-extractor test -- tests/url-record-normalizer.test.js`
Expected: FAIL because the normalizer does not exist yet.

- [ ] **Step 3: Implement the minimal normalizer using the existing fixed header shape**

```js
function normalizeUrlFieldsToRecord(input) {
  return {
    record_id: `${input.snapshotDate}:${input.sourceUrl}`,
    snapshot_date: input.snapshotDate,
    company_name: input.companyName || '',
    batch: '',
    company_type: '',
    industry: '',
    target_candidates: '',
    job_title_raw: input.jobTitleRaw || '',
    job_status_raw: '',
    location_raw: input.locationRaw || '',
    updated_at_raw: '',
    deadline_raw: input.deadlineRaw || '',
    official_notice_text: input.title || '',
    apply_text: '',
    remark_raw: '',
    official_notice_url: input.sourceUrl,
    apply_url: input.applyUrl || '',
    source_url: input.sourceUrl,
    extracted_at: input.extractedAt,
  }
}

module.exports = { normalizeUrlFieldsToRecord }
```

- [ ] **Step 4: Re-run the normalization test**

Run: `npm --workspace @zhaoping/tencent-docs-recruiting-extractor test -- tests/url-record-normalizer.test.js`
Expected: PASS

### Task 4: Verify The URL Path Still Matches The Existing Contract

**Files:**
- Modify: `packages/tencent-docs-recruiting-extractor/tests/contract.test.js`

- [ ] **Step 1: Write the failing contract test**

```js
test('url markdown path emits the same fixed header order as the existing recruiting contract', () => {
  const record = normalizeUrlFieldsToRecord({
    snapshotDate: '2026-04-09',
    extractedAt: '2026-04-09T10:00:00.000Z',
    sourceUrl: 'https://example.edu/jobs/123',
    companyName: '某科技公司',
    jobTitleRaw: '研发工程师',
  })

  assert.deepEqual(Object.keys(record), FIXED_HEADERS)
})
```

- [ ] **Step 2: Run the contract test**

Run: `npm --workspace @zhaoping/tencent-docs-recruiting-extractor test -- tests/contract.test.js`
Expected: PASS after the normalizer is implemented.

### Task 5: Wire The URL Path Into `extract-once.js`

**Files:**
- Modify: `packages/tencent-docs-recruiting-extractor/scripts/extract-once.js`
- Modify: `packages/tencent-docs-recruiting-extractor/scripts/lib/config.js`
- Test: `packages/tencent-docs-recruiting-extractor/tests/config.test.js`
- Test: `packages/tencent-docs-recruiting-extractor/tests/extract-once.test.js`

- [ ] **Step 1: Write the failing config test for direct URL input support**

```js
test('loadConfig accepts a direct url input for webpage extraction', async () => {
  const config = await loadConfigFromObject({
    url: 'https://example.edu/jobs/123',
  })

  assert.equal(config.url, 'https://example.edu/jobs/123')
})
```

- [ ] **Step 2: Write the failing integration test for the new URL branch**

```js
test('runExtract supports a direct url markdown path and writes recruiting.csv', async () => {
  const result = await runExtract({
    config: { url: 'https://example.edu/jobs/123' },
    fetchUrlAsMarkdown: async () => ({
      sourceUrl: 'https://example.edu/jobs/123',
      title: '某科技公司 2026 校园招聘',
      markdownContent: '# 某科技公司 2026 校园招聘\n招聘岗位：研发工程师',
      fetchedAt: '2026-04-09T10:00:00.000Z',
    }),
  })

  assert.equal(result.status, 'success')
})
```

- [ ] **Step 3: Run the two tests and verify they fail**

Run: `npm --workspace @zhaoping/tencent-docs-recruiting-extractor test -- tests/config.test.js tests/extract-once.test.js`
Expected: FAIL because config and entrypoint do not yet support the URL branch.

- [ ] **Step 4: Implement the minimal config and entrypoint branch**

```js
if (config.url) {
  const document = await fetchUrlAsMarkdown(config.url, dependencies)
  const fields = extractRecruitingFields(document)

  if (!fields.companyName && !fields.jobTitleRaw) {
    throw new Error('Unable to extract recruiting fields from markdown content')
  }

  const record = normalizeUrlFieldsToRecord({
    ...fields,
    snapshotDate: context.snapshotDate,
    extractedAt: document.fetchedAt,
  })

  await writeRecords([record], context)
  return buildSuccessSummary(/* preserve current summary shape */)
}
```

- [ ] **Step 5: Re-run the two tests**

Run: `npm --workspace @zhaoping/tencent-docs-recruiting-extractor test -- tests/config.test.js tests/extract-once.test.js`
Expected: PASS

### Task 6: Document The New URL Path And Run Full Extractor Verification

**Files:**
- Modify: `packages/tencent-docs-recruiting-extractor/README.md`

- [ ] **Step 1: Update the extractor README with the new URL path**

```md
## 新增 URL 路径

除了腾讯文档源表，本阶段还支持网页正文型 URL：

- 传入一个普通网页 URL
- 使用 markdown 抓取路径获取页面正文
- 从 markdown 中提取招聘字段
- 输出仍兼容当前 `recruiting.csv` 契约

本版本暂不覆盖附件解析、PDF 深度解析和多模板泛化。
```

- [ ] **Step 2: Run the full extractor test suite**

Run: `npm --workspace @zhaoping/tencent-docs-recruiting-extractor test`
Expected: all extractor tests pass

## Self-Review

- Spec coverage: this plan matches the lightweight webpage URL -> markdown -> CSV route, preserves the Tencent Docs path, and keeps phase-two compatibility intact.
- Placeholder scan: every task contains explicit file paths, code snippets, and commands.
- Type consistency: the plan consistently uses `fetchUrlAsMarkdown`, `extractRecruitingFields`, and `normalizeUrlFieldsToRecord` across all tasks.
