const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

// 발행·저장 결과를 사용자별 history.json에 보관한다.
// 이 기록은 화면의 발행 이력, 키워드 중복 방지, 내부링크 후보 선택에 함께 쓰인다.
function getHistoryFilePath() {
  return path.join(app.getPath('userData'), 'history.json');
}

function loadHistory() {
  // 기록 파일이 없거나 손상되어도 앱 전체가 멈추지 않도록 빈 기록으로 시작한다.
  const filePath = getHistoryFilePath();
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

/**
 * 발행/저장 기록을 추가한다 (최신순으로 유지).
 * entry: { keyword, title, mode, status: 'success'|'failure', url?, message? }
 * 각 기록에 고유 번호와 작성 시각을 붙여 나중에 중복 검사와 화면 표시에서 구분한다.
 */
function addHistoryEntry(entry) {
  const history = loadHistory();
  history.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: new Date().toISOString(),
    ...entry,
  });
  fs.mkdirSync(path.dirname(getHistoryFilePath()), { recursive: true });
  fs.writeFileSync(getHistoryFilePath(), JSON.stringify(history, null, 2), 'utf-8');
  return history;
}

function listHistory() {
  // 화면은 이 함수를 통해서만 기록 목록을 받는다.
  return loadHistory();
}

/** 지금까지 (수동 입력이든 자동추천이든) 한 번이라도 쓴 키워드 목록을 중복 없이 반환한다. */
function getUsedKeywords() {
  const history = loadHistory();
  const keywords = history.map((entry) => entry.keyword).filter(Boolean);
  return Array.from(new Set(keywords));
}

/** 네이버에 실제 공개 발행된 성공 기록의 키워드만 반환한다. 비공개 검증 글은 추천에서 제외한다. */
function getPublishedKeywords() {
  const keywords = loadHistory()
    .filter(
      (entry) =>
        entry?.status === 'success' &&
        entry?.visibility !== 'private' &&
        /^https:\/\/blog\.naver\.com\//i.test(entry.url || '')
    )
    .map((entry) => entry.keyword)
    .filter(Boolean);
  return Array.from(new Set(keywords));
}

module.exports = { addHistoryEntry, listHistory, getPublishedKeywords, getUsedKeywords };
