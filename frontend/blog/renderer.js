import { initStyledBlogView } from '../shared/views/blog.js';
import { initStyledHistoryView } from '../shared/views/history.js';
import { initStyledSettingsView } from '../shared/views/settings.js';

// 화면 이름과 안내 문구를 한곳에서 관리해 사이드바와 상단 탭이 같은 정보를 보여 주게 한다.
const pageMeta = {
  main: {
    context: '콘텐츠 생성',
    title: '블로그 콘텐츠 만들기',
    description: '키워드와 발행 방식을 선택해 네이버 블로그 콘텐츠를 준비합니다.',
  },
  history: {
    context: '발행 관리',
    title: '발행 기록',
    description: '네이버 블로그 콘텐츠의 생성, 예약 및 발행 결과를 확인합니다.',
  },
  settings: {
    context: '환경 설정',
    title: '설정',
    description: 'AI 서비스, 네이버 계정, 발행 기본값과 결과 저장 위치를 관리합니다.',
  },
};

// 기존 화면 모듈의 기능은 그대로 두고 공통 디자인 장식만 추가한다.
const tabs = {
  main: {
    panel: document.getElementById('tab-main'),
    init: initStyledBlogView,
    loaded: false,
  },
  history: {
    panel: document.getElementById('tab-history'),
    init: (panel) => initStyledHistoryView(panel, { platformTabs: false }),
    loaded: false,
    reloadOnActivate: true,
  },
  settings: {
    panel: document.getElementById('tab-settings'),
    init: (panel) => initStyledSettingsView(panel, { includeInstagram: false }),
    loaded: false,
  },
};

async function activateTab(tabId) {
  const selected = tabs[tabId];
  if (!selected) return;

  document.body.dataset.activeTab = tabId;
  Object.entries(tabs).forEach(([id, tab]) => {
    const active = id === tabId;
    tab.panel.classList.toggle('active', active);

    const navigationButton = document.querySelector(`[data-tab="${id}"]`);
    navigationButton?.classList.toggle('active', active);
    if (active) navigationButton?.setAttribute('aria-current', 'page');
    else navigationButton?.removeAttribute('aria-current');

    document.querySelectorAll(`[data-target-tab="${id}"]`).forEach((button) => {
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
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

document.querySelectorAll('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => activateTab(button.dataset.tab));
});

document.querySelectorAll('[data-target-tab]').forEach((button) => {
  button.addEventListener('click', () => activateTab(button.dataset.targetTab));
});

activateTab('main');
