/**
 * Creator의 왼쪽 메뉴와 각 화면을 연결하는 프론트엔드 진입점이다.
 * 사용자가 탭을 바꾸면 해당 화면 모듈을 불러오고 현재 상태를 갱신한다.
 */
import { initDashboardView } from './views/dashboard.js';
import { initCreatorHistoryView } from './views/history.js';
import { initInstagramView } from './views/instagram.js';
import { initYoutubeView } from './views/youtube.js';
import { initCreatorSettingsView } from './views/settings.js';
import { initStyledBlogView } from '../shared/views/blog.js';

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

const tabs = {
  dashboard: {
    panel: document.getElementById('tab-dashboard'),
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

async function activateTab(tabId) {
  const selected = tabs[tabId];
  if (!selected) return;

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

document.querySelectorAll('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => activateTab(button.dataset.tab));
});

document.querySelectorAll('[data-target-tab]').forEach((button) => {
  button.addEventListener('click', () => activateTab(button.dataset.targetTab));
});

activateTab('dashboard');
