function appendNewDate(headers, record, newDate) {
  const nextHeaders = headers.includes('new_date') ? headers.slice() : [...headers, 'new_date'];

  return {
    headers: nextHeaders,
    record: {
      ...record,
      new_date: newDate,
    },
  };
}

function parseSnapshotDate(snapshotDate) {
  const [year, month, day] = String(snapshotDate).split('-').map((part) => Number(part));
  return new Date(Date.UTC(year, month - 1, day));
}

function formatSnapshotDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(snapshotDate, days) {
  const date = parseSnapshotDate(snapshotDate);
  date.setUTCDate(date.getUTCDate() + days);
  return formatSnapshotDate(date);
}

function makeSnapshotRecordsMap(records) {
  const map = new Map();

  for (const record of records || []) {
    map.set(String(record.record_id), record);
  }

  return map;
}

function computeTodayNew({ currentRecords, previousRecords, headers, snapshotDate }) {
  const { headers: outputHeaders } = appendNewDate(headers, {}, snapshotDate);

  if (!previousRecords || previousRecords.length === 0) {
    return {
      headers: outputHeaders,
      records: [],
      diffStatus: 'insufficient_history',
    };
  }

  const previousIds = new Set(previousRecords.map((record) => String(record.record_id)));
  const records = [];

  for (const record of currentRecords) {
    if (previousIds.has(String(record.record_id))) {
      continue;
    }

    records.push(appendNewDate(headers, record, snapshotDate).record);
  }

  return {
    headers: outputHeaders,
    records,
    diffStatus: 'complete',
  };
}

function computeRecent7d({ currentRecords, windowSnapshots, headers }) {
  const { headers: outputHeaders } = appendNewDate(headers, {}, '');

  if (!Array.isArray(windowSnapshots) || windowSnapshots.length === 0 || currentRecords.length === 0) {
    return {
      headers: outputHeaders,
      records: [],
      diffStatus: 'insufficient_history',
    };
  }

  const currentSnapshotDate = String(currentRecords[0].snapshot_date || '').trim();
  if (!currentSnapshotDate) {
    return {
      headers: outputHeaders,
      records: [],
      diffStatus: 'insufficient_history',
    };
  }

  const windowStartDate = addDays(currentSnapshotDate, -6);
  const snapshots = [...windowSnapshots]
    .map((snapshot) => ({
      ...snapshot,
      snapshotDate: String(snapshot.snapshotDate || '').trim(),
    }))
    .filter((snapshot) => snapshot.snapshotDate)
    .sort((left, right) => {
      if (left.snapshotDate !== right.snapshotDate) {
        return left.snapshotDate < right.snapshotDate ? -1 : 1;
      }

      return 0;
    });

  const baselineCandidates = snapshots.filter((snapshot) => snapshot.snapshotDate < windowStartDate);
  const baselineSnapshot = baselineCandidates[baselineCandidates.length - 1];

  if (!baselineSnapshot) {
    return {
      headers: outputHeaders,
      records: [],
      diffStatus: 'insufficient_history',
    };
  }

  const windowedSnapshots = snapshots.filter(
    (snapshot) => snapshot.snapshotDate >= windowStartDate && snapshot.snapshotDate <= currentSnapshotDate
  );

  if (windowedSnapshots.length === 0) {
    return {
      headers: outputHeaders,
      records: [],
      diffStatus: 'insufficient_history',
    };
  }

  const currentIds = new Set(currentRecords.map((record) => String(record.record_id)));
  let previousRecordsMap = makeSnapshotRecordsMap(baselineSnapshot.records);
  const firstSeenDates = new Map();

  for (const snapshot of windowedSnapshots) {
    const currentRecordsMap = makeSnapshotRecordsMap(snapshot.records);

    for (const [recordId, record] of currentRecordsMap.entries()) {
      if (previousRecordsMap.has(recordId)) {
        continue;
      }

      if (!currentIds.has(recordId)) {
        continue;
      }

      if (!firstSeenDates.has(recordId)) {
        firstSeenDates.set(recordId, snapshot.snapshotDate);
      }
    }

    previousRecordsMap = currentRecordsMap;
  }

  const records = [];

  for (const record of currentRecords) {
    const newDate = firstSeenDates.get(String(record.record_id));
    if (!newDate) {
      continue;
    }

    records.push(appendNewDate(headers, record, newDate).record);
  }

  return {
    headers: outputHeaders,
    records,
    diffStatus: 'complete',
  };
}

module.exports = {
  appendNewDate,
  computeRecent7d,
  computeTodayNew,
};
