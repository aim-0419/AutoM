/**
 * [작업 기록 담당 - "무엇을 언제 만들고 올렸는가"]
 *
 * 비개발자를 위한 설명:
 * - 글 생성/발행, 인스타 카드 발행, 유튜브 영상 제작 결과를 `history.json` 파일에 계속 쌓아둡니다.
 * - 이 기록은 세 가지 용도로 쓰입니다.
 *   1) 화면의 '기록' 탭에 목록으로 보여주기
 *   2) 같은 키워드로 또 글을 쓰지 않도록 중복 방지
 *   3) 새 글에서 내 기존 글로 연결하는 '내부 링크' 후보 찾기
 */
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

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

/**
 * 네이버에 실제 '공개' 발행된 성공 기록의 키워드만 반환한다.
 * - 실패한 글, 비공개(테스트용) 글, 주소가 네이버 블로그가 아닌 기록은 제외한다.
 * - 새 글에서 내 기존 글로 링크를 걸 때 "실제로 존재하는 공개 글"만 후보가 되도록 하기 위함이다.
 */
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
