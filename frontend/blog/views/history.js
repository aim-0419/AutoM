const MODE_LABELS = {
  'semi-auto': '반자동',
  review: '확인 후 발행',
  'full-auto': '완전자동',
  scheduled: '예약발행',
  'instagram-browser': '인스타그램',
  'instagram-browser-live-test': '인스타그램',
  'youtube-shorts': '쇼츠 생성',
  'youtube-longform': '롱폼 생성',
};

const PLATFORM_TABS = [
  { id: 'blog', label: '블로그' },
  { id: 'instagram', label: '인스타그램' },
  { id: 'youtube', label: '유튜브' },
];

// 발행 기록 화면은 저장된 결과를 읽어 표 형태로 보여 주고, 실제 게시물은 기본 브라우저에서 연다.
function escapeHtml(str) {
  // 기록의 제목·키워드가 HTML로 해석되지 않게 안전하게 표시한다.
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDate(iso) {
  // 파일에 저장된 국제 표준 시간을 사용자가 읽기 쉬운 날짜·시각으로 바꾼다.
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateParts(iso) {
  const formatted = formatDate(iso);
  const [date = '-', time = ''] = formatted.split(' ');
  return { date, time };
}

function renderDateTime(iso) {
  const { date, time } = formatDateParts(iso);
  return `
    <time class="history-date-time" datetime="${escapeAttr(iso)}">
      <span>${date}</span>
      <span>${time}</span>
    </time>
  `;
}

function getEntryPlatform(entry) {
  // 플랫폼 값이 없던 기존 기록은 모두 네이버 블로그 기록이므로 블로그 탭에 포함한다.
  const platform = String(entry?.platform || '').toLocaleLowerCase();
  if (platform === 'instagram') return 'instagram';
  if (platform === 'youtube') return 'youtube';
  return 'blog';
}

function renderRows(rowsEl, entries) {
  rowsEl.innerHTML = '';
  entries.forEach((entry) => {
    const tr = document.createElement('tr');
    const statusClass = entry.status === 'success' ? 'success' : 'error';
    const isWaitingForSchedule =
      entry.status === 'success' && entry.scheduledAt && Date.parse(entry.scheduledAt) > Date.now();
    const statusLabel = entry.status === 'success' ? (isWaitingForSchedule ? '예약' : '성공') : '실패';

    tr.innerHTML = `
      <td>${renderDateTime(entry.date)}</td>
      <td title="${escapeAttr(entry.keyword || '-')}">${escapeHtml(entry.keyword || '-')}</td>
      <td title="${escapeAttr(entry.title || '-')}">${escapeHtml(entry.title || '-')}</td>
      <td>${escapeHtml(MODE_LABELS[entry.mode] || entry.mode || '-')}</td>
      <td><span class="test-result ${statusClass}">${statusLabel}</span></td>
      <td>${entry.scheduledAt ? renderDateTime(entry.scheduledAt) : '-'}</td>
      <td></td>
    `;

    const urlCell = tr.lastElementChild;
    if (entry.url) {
      // 외부 주소 열기는 화면 코드가 직접 하지 않고, 안전 검사를 하는 메인 프로그램에 요청한다.
      const link = document.createElement('a');
      link.href = '#';
      link.textContent = '열기';
      link.addEventListener('click', (event) => {
        event.preventDefault();
        window.api.historyOpenUrl(entry.url);
      });
      urlCell.appendChild(link);
    } else {
      urlCell.textContent = '-';
    }

    rowsEl.appendChild(tr);
  });
}

export async function initHistoryView(
  container,
  { platformTabs = false, renderEmptyShell = false } = {}
) {
  // 탭을 열 때마다 최근 기록을 다시 불러와 방금 끝난 자동발행도 즉시 보여 준다.
  container.innerHTML = `<p class="placeholder">발행 기록을 불러오는 중...</p>`;

  const entries = await window.api.historyList();

  if (entries.length === 0 && !platformTabs && !renderEmptyShell) {
    container.innerHTML = `<p class="placeholder">아직 발행 기록이 없습니다.</p>`;
    return;
  }

  const platformTabsHtml = platformTabs
    ? `<div class="history-platform-tabs" role="tablist" aria-label="플랫폼별 발행 기록">
        ${PLATFORM_TABS.map((platform, index) => {
          const count = entries.filter((entry) => getEntryPlatform(entry) === platform.id).length;
          return `<button type="button" class="history-platform-tab${index === 0 ? ' active' : ''}" data-history-platform="${platform.id}" role="tab" aria-selected="${index === 0}" tabindex="${index === 0 ? '0' : '-1'}">${platform.label}<span class="history-platform-count">${count}</span></button>`;
        }).join('')}
      </div>`
    : '';

  container.innerHTML = `
    <div class="settings-section">
      <h2>발행 기록</h2>
      ${platformTabsHtml}
      <div class="history-table-wrap">
        <table class="history-table">
          <thead>
            <tr>
              <th>날짜</th>
              <th>키워드</th>
              <th>제목</th>
              <th>모드</th>
              <th>상태</th>
              <th>예약 시각</th>
              <th>URL</th>
            </tr>
          </thead>
          <tbody id="history-rows"></tbody>
        </table>
      </div>
      <p id="history-platform-empty" class="placeholder history-platform-empty" hidden></p>
    </div>
  `;

  const rowsEl = container.querySelector('#history-rows');
  const tableWrap = container.querySelector('.history-table-wrap');
  const emptyEl = container.querySelector('#history-platform-empty');

  const showPlatform = (platformId) => {
    const platform = PLATFORM_TABS.find((item) => item.id === platformId) || PLATFORM_TABS[0];
    const filteredEntries = platformTabs
      ? entries.filter((entry) => getEntryPlatform(entry) === platform.id)
      : entries;
    renderRows(rowsEl, filteredEntries);
    tableWrap.hidden = filteredEntries.length === 0;
    emptyEl.hidden = filteredEntries.length > 0;
    emptyEl.textContent = `${platform.label} 발행 기록이 없습니다.`;

    container.querySelectorAll('.history-platform-tab').forEach((button) => {
      const selected = button.dataset.historyPlatform === platform.id;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
  };

  if (platformTabs) {
    const tabButtons = Array.from(container.querySelectorAll('.history-platform-tab'));
    tabButtons.forEach((button, index) => {
      button.addEventListener('click', () => showPlatform(button.dataset.historyPlatform));
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const offset = event.key === 'ArrowRight' ? 1 : -1;
        const nextIndex = (index + offset + tabButtons.length) % tabButtons.length;
        tabButtons[nextIndex].click();
        tabButtons[nextIndex].focus();
      });
    });
    showPlatform('blog');
  } else {
    renderRows(rowsEl, entries);
    tableWrap.hidden = entries.length === 0;
    emptyEl.hidden = entries.length > 0;
    emptyEl.textContent = '블로그 발행 기록이 없습니다.';
  }
}
