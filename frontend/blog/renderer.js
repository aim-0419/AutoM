/**
 * [블로그 앱 화면 전환 담당]
 *
 * 비개발자를 위한 설명:
 * - 이 앱은 창을 하나만 쓰고, 왼쪽 메뉴를 누르면 그 자리에서 내용만 바뀝니다.
 *   (새 창이 뜨지 않는 이유입니다)
 * - 이 파일은 "어떤 메뉴를 눌렀을 때 어떤 화면을 보여줄지"를 관리합니다.
 * - 각 화면은 처음 열 때 한 번만 만들어 두고 재사용합니다. 다만 '발행 기록'처럼
 *   내용이 계속 바뀌는 화면은 열 때마다 새로 불러옵니다(reloadOnActivate).
 */
import { initStyledBlogView } from '../shared/views/blog.js';
import { initStyledHistoryView } from '../shared/views/history.js';
import { initStyledSettingsView } from '../shared/views/settings.js';

// 화면 이름과 안내 문구를 한곳에서 관리해 사이드바와 상단 탭이 같은 정보를 보여 주게 한다.
// (화면 위쪽에 표시되는 제목·설명이 여기서 나온다)
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

/**
 * 메뉴 3개와 각각의 화면을 연결한 표다.
 *   panel : 내용이 들어갈 자리 (HTML의 특정 영역)
 *   init  : 그 화면을 실제로 그리는 함수
 *   loaded: 이미 한 번 그렸는지 표시
 *   reloadOnActivate: 열 때마다 새로 그릴지 여부
 *
 * 블로그 전용 앱은 인스타그램 기능이 없으므로 설정 화면에서 해당 항목을 감춘다
 * (includeInstagram: false). 기록 화면도 플랫폼 구분 탭 없이 블로그만 보여준다.
 */
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

/**
 * 메뉴를 눌렀을 때 실행되는 화면 전환 함수.
 * 순서: 선택 표시 갱신 → 화면 위쪽 제목·설명 교체 → 화면 그리기 → 스크롤 맨 위로
 * 화면을 그리다 오류가 나면 앱이 멈추지 않도록, 그 자리에 오류 메시지만 보여준다.
 */
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

// 왼쪽 메뉴 버튼들에 클릭 동작을 연결한다.
document.querySelectorAll('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => activateTab(button.dataset.tab));
});

// 화면 안에서 다른 화면으로 이동시키는 버튼들(예: "설정으로 가기")에도 같은 동작을 연결한다.
document.querySelectorAll('[data-target-tab]').forEach((button) => {
  button.addEventListener('click', () => activateTab(button.dataset.targetTab));
});

// 앱을 켰을 때 가장 먼저 보여줄 화면
activateTab('main');
