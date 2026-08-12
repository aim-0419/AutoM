/**
 * [발행 기록 화면 '꾸미기' 담당 - 두 앱 공통]
 *
 * 비개발자를 위한 설명:
 * - 기록 목록을 실제로 불러오는 일은 blog/views/history.js가 합니다.
 *   이 파일은 그 위에 보기 편한 요소를 덧붙입니다.
 *     · "현재 보기: 블로그 · 12건" 같은 요약 표시
 *     · 성공/실패/예약을 색깔로 구분하는 상태 배지
 *     · 긴 글자가 잘렸을 때 마우스를 올리면 전체가 보이는 툴팁
 *     · 링크 이름을 '결과 열기'로 통일
 * - Creator 앱은 블로그·인스타그램·유튜브 탭을 함께 보여주고(platformTabs: true),
 *   블로그 전용 앱은 탭 없이 블로그 기록만 보여줍니다(platformTabs: false).
 */
import { initHistoryView } from '../../blog/views/history.js';

// 플랫폼별 표시 이름과, 기록이 하나도 없을 때 보여줄 안내 문구
const HISTORY_PLATFORMS = {
  blog: {
    label: '블로그',
    empty: '아직 블로그 작업 기록이 없습니다. 콘텐츠를 생성하거나 발행하면 이곳에 표시됩니다.',
  },
  instagram: {
    label: '인스타그램',
    empty: '아직 인스타그램 작업 기록이 없습니다. 카드 콘텐츠를 생성하거나 발행하면 이곳에 표시됩니다.',
  },
  youtube: {
    label: '유튜브',
    empty: '아직 유튜브 콘텐츠 생성 기록이 없습니다. 영상 콘텐츠를 생성하면 이곳에 표시됩니다.',
  },
};

/**
 * 기록 표의 각 줄을 꾸민다.
 *  · 열마다 이름표를 붙여 CSS가 너비를 조절할 수 있게 한다
 *  · 글자가 길어 잘릴 수 있으므로 마우스를 올리면 전체 내용이 보이게 한다
 *  · 상태(성공/실패/예약)에 따라 다른 색이 적용되도록 표시를 붙인다
 */
function decorateHistoryRows(container, platformId) {
  const platformLabel = HISTORY_PLATFORMS[platformId]?.label || '선택한 플랫폼';
  const cellClasses = [
    'creator-history-date',
    'creator-history-keyword',
    'creator-history-title',
    'creator-history-mode',
    'creator-history-state',
    'creator-history-schedule',
    'creator-history-url',
  ];

  container.querySelectorAll('#history-rows tr').forEach((row) => {
    row.classList.add('creator-history-row');
    row.querySelectorAll('td').forEach((cell, index) => {
      cell.classList.add(cellClasses[index]);
      const fullText = cell.textContent.trim();
      if (fullText && !cell.hasAttribute('title') && !cell.querySelector('a')) {
        cell.title = fullText;
      }
    });

    const status = row.querySelector('.test-result');
    if (status) {
      status.classList.add('creator-history-status');
      if (status.textContent.trim() === '예약') {
        status.classList.add('is-scheduled');
      } else if (status.classList.contains('success')) {
        status.classList.add('is-success');
      } else if (status.classList.contains('error')) {
        status.classList.add('is-error');
      } else {
        status.classList.add('is-neutral');
      }
    }

    const link = row.querySelector('a');
    if (link) {
      link.classList.add('creator-history-link');
      link.textContent = '결과 열기';
      link.setAttribute('aria-label', `${platformLabel} 결과를 외부 브라우저에서 열기`);
      link.title = '외부 브라우저에서 결과 열기';
    }
  });
}

function decorateHistoryView(container, { platformTabs }) {
  container.classList.add('creator-history-view');

  const card = container.querySelector('.settings-section');
  const tabsElement = container.querySelector('.history-platform-tabs');
  const table = container.querySelector('.history-table');
  const rows = container.querySelector('#history-rows');
  const empty = container.querySelector('#history-platform-empty');
  if (!card || !table || !rows || !empty) return;

  card.classList.add('creator-history-card');
  const sectionTitle = card.querySelector('h2');
  if (sectionTitle) {
    sectionTitle.id = 'creator-history-list-title';
    sectionTitle.textContent = platformTabs ? '플랫폼별 기록' : '블로그 발행 기록';
  }

  const summary = document.createElement('div');
  summary.className = 'creator-history-summary';
  summary.innerHTML = `
    <div>
      <span>현재 보기</span>
      <strong id="creator-history-current-platform">블로그</strong>
    </div>
    <p>${platformTabs
      ? '플랫폼 탭을 선택하면 해당 작업 기록만 확인할 수 있습니다.'
      : '네이버 블로그 발행, 예약 및 생성 결과를 확인할 수 있습니다.'}</p>
  `;
  (tabsElement || table.closest('.history-table-wrap')).before(summary);

  tabsElement?.setAttribute('aria-labelledby', 'creator-history-list-title');
  table.setAttribute(
    'aria-label',
    platformTabs ? '선택한 플랫폼의 발행 및 콘텐츠 생성 기록' : '네이버 블로그 발행 기록'
  );
  table.querySelectorAll('th').forEach((header) => header.setAttribute('scope', 'col'));
  rows.setAttribute('aria-live', 'polite');
  empty.setAttribute('aria-live', 'polite');

  // 플랫폼 탭을 바꿀 때마다 요약 문구와 줄 디자인을 다시 맞춰주는 함수
  const syncPresentation = () => {
    const activeTab =
      container.querySelector('.history-platform-tab.active') ||
      container.querySelector('.history-platform-tab');
    const platformId = platformTabs ? activeTab?.dataset.historyPlatform || 'blog' : 'blog';
    const platform = HISTORY_PLATFORMS[platformId] || HISTORY_PLATFORMS.blog;
    const count = platformTabs
      ? activeTab?.querySelector('.history-platform-count')?.textContent.trim() || '0'
      : String(rows.querySelectorAll('tr').length);

    card.dataset.activeHistoryPlatform = platformId;
    summary.querySelector('#creator-history-current-platform').textContent =
      `${platform.label} · ${count}건`;
    if (!empty.hidden) empty.textContent = platform.empty;
    decorateHistoryRows(container, platformId);
  };

  container.querySelectorAll('.history-platform-tab').forEach((button) => {
    const platformId = button.dataset.historyPlatform;
    const platform = HISTORY_PLATFORMS[platformId];
    const count = button.querySelector('.history-platform-count')?.textContent.trim() || '0';
    if (platform) button.setAttribute('aria-label', `${platform.label} 기록 ${count}건`);
    button.addEventListener('click', syncPresentation);
  });

  syncPresentation();
}

/**
 * 기록 화면을 그린다.
 * platformTabs가 true면 블로그·인스타·유튜브 탭을 함께 보여준다(Creator 앱).
 */
export async function initStyledHistoryView(container, { platformTabs = false } = {}) {
  await initHistoryView(container, { platformTabs, renderEmptyShell: true });
  decorateHistoryView(container, { platformTabs });
}
