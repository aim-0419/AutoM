/**
 * [Creator 앱 화면 전환 담당]
 *
 * 비개발자를 위한 설명:
 * - 왼쪽 메뉴 6개(대시보드 / 블로그 / 인스타그램 / 유튜브 / 기록 / 설정)와
 *   각 화면을 연결합니다. 메뉴를 누르면 창 안의 내용만 바뀝니다.
 * - 블로그 화면은 블로그 전용 앱(AutoM)과 완전히 같은 코드를 공유합니다.
 *   두 앱에서 동작이 달라지는 일이 없도록 한 곳(shared/views/blog.js)에서 관리합니다.
 * - 대시보드와 기록 화면은 열 때마다 최신 정보로 다시 그립니다(reloadOnActivate).
 */
import { initDashboardView } from './views/dashboard.js';
import { initCreatorHistoryView } from './views/history.js';
import { initInstagramView } from './views/instagram.js';
import { initYoutubeView } from './views/youtube.js';
import { initCreatorSettingsView } from './views/settings.js';
import { initStyledBlogView } from '../shared/views/blog.js';

// 화면마다 위쪽에 표시할 분류·제목·설명 문구
const pageMeta = {
  dashboard: {
    context: '작업 개요',
    title: '대시보드',
    description: 'AI 설정, 플랫폼 연결 상태와 최근 콘텐츠 작업을 한곳에서 확인합니다.',
  },
  blog: {
    context: '콘텐츠 생성',
    title: '블로그 콘텐츠 만들기',
    description: '키워드와 발행 방식을 선택해 네이버 블로그 콘텐츠를 준비합니다.',
  },
  instagram: {
    context: '콘텐츠 생성',
    title: '인스타그램 카드 만들기',
    description: '주제와 카드 수를 선택해 이미지 카드와 캡션을 준비합니다.',
  },
  youtube: {
    context: '콘텐츠 생성',
    title: '유튜브 콘텐츠 만들기',
    description: '채널 기준과 영상 주제를 입력해 대본, 이미지 및 영상 콘텐츠를 준비합니다.',
  },
  history: {
    context: '발행 관리',
    title: '발행 기록',
    description: '블로그·인스타그램 작업과 유튜브 콘텐츠 생성 기록을 플랫폼별로 확인합니다.',
  },
  settings: {
    context: '환경 설정',
    title: '설정',
    description: 'AI 서비스, 플랫폼 계정, 발행 기본값과 결과 저장 위치를 관리합니다.',
  },
};

/**
 * 메뉴 6개와 각각의 화면을 연결한 표다.
 *   panel : 내용이 들어갈 자리, init : 화면을 그리는 함수,
 *   loaded: 이미 그렸는지, reloadOnActivate: 열 때마다 새로 그릴지
 */
const tabs = {
  dashboard: {
    panel: document.getElementById('tab-dashboard'),
    // 대시보드의 바로가기 버튼이 다른 화면으로 이동할 수 있도록 이동 함수를 함께 넘긴다.
    init: (panel) => initDashboardView(panel, { navigate: activateTab }),
    loaded: false,
    reloadOnActivate: true,
  },
  blog: { panel: document.getElementById('tab-blog'), init: initStyledBlogView, loaded: false },
  instagram: { panel: document.getElementById('tab-instagram'), init: initInstagramView, loaded: false },
  youtube: { panel: document.getElementById('tab-youtube'), init: initYoutubeView, loaded: false },
  history: { panel: document.getElementById('tab-history'), init: initCreatorHistoryView, loaded: false, reloadOnActivate: true },
  settings: { panel: document.getElementById('tab-settings'), init: initCreatorSettingsView, loaded: false },
};

/**
 * 메뉴를 눌렀을 때 실행되는 화면 전환 함수.
 * 순서: 선택 표시 갱신 → 화면 위쪽 제목·설명 교체 → 화면 그리기 → 스크롤 맨 위로
 * 화면을 그리다 오류가 나도 앱이 멈추지 않도록, 그 자리에 오류 메시지만 표시한다.
 */
async function activateTab(tabId) {
  const selected = tabs[tabId];
  if (!selected) return;

  // 대시보드만 배경 디자인이 달라서 body에 표시를 남겨 CSS가 구분할 수 있게 한다.
  document.body.classList.toggle('creator-dashboard-active', tabId === 'dashboard');
  document.body.dataset.activeTab = tabId;

  Object.entries(tabs).forEach(([id, tab]) => {
    tab.panel.classList.toggle('active', id === tabId);
    const navigationButton = document.querySelector(`[data-tab="${id}"]`);
    navigationButton?.classList.toggle('active', id === tabId);
    if (id === tabId) {
      navigationButton?.setAttribute('aria-current', 'page');
    } else {
      navigationButton?.removeAttribute('aria-current');
    }

    document.querySelectorAll(`[data-target-tab="${id}"]`).forEach((targetButton) => {
      targetButton.classList.toggle('active', id === tabId);
      if (id === tabId) {
        targetButton.setAttribute('aria-current', 'page');
      } else {
        targetButton.removeAttribute('aria-current');
      }
    });
  });

  const meta = pageMeta[tabId];
  document.getElementById('creator-page-context').textContent = meta.context;
  document.getElementById('creator-page-title').textContent = meta.title;
  document.getElementById('creator-page-description').textContent = meta.description;

  if (!selected.loaded || selected.reloadOnActivate) {
    try {
      await selected.init(selected.panel);
      selected.loaded = true;
    } catch (error) {
      selected.panel.innerHTML = '<p class="placeholder"></p>';
      selected.panel.querySelector('.placeholder').textContent =
        `화면을 불러오지 못했습니다: ${String(error?.message || error)}`;
    }
  }

  const pageScroller = document.querySelector('.creator-page');
  if (pageScroller) {
    pageScroller.scrollTop = 0;
    pageScroller.scrollLeft = 0;
  }
}

// 왼쪽 메뉴 버튼들에 클릭 동작을 연결한다.
document.querySelectorAll('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => activateTab(button.dataset.tab));
});

// 화면 안에서 다른 화면으로 이동시키는 버튼들(대시보드의 바로가기 등)도 연결한다.
document.querySelectorAll('[data-target-tab]').forEach((button) => {
  button.addEventListener('click', () => activateTab(button.dataset.targetTab));
});

// 앱을 켰을 때 가장 먼저 보여줄 화면
activateTab('dashboard');
