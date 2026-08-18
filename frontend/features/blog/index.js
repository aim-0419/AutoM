/**
 * [블로그 화면 '꾸미기' 담당 - 두 앱 공통]
 *
 * 비개발자를 위한 설명:
 * - 블로그 화면의 실제 기능(키워드 입력, 생성, 발행)은 같은 폴더의 base.js가 만듭니다.
 *   이 파일은 그 위에 '보기 좋게 하는 요소'만 덧붙입니다.
 *     · 상단의 1→2→3→4 제작 단계 안내
 *     · 입력칸 아래 도움말 문구
 *     · 완전자동·예약발행 선택지에 붙는 빨간 '주의' 표시
 *     · 생성 버튼 옆의 "현재 선택: 반자동" 표시
 *     · 발행 전 확인 안내 상자
 * - 기능과 디자인을 이렇게 나눈 이유: AutoM과 Creator 두 앱이 같은 블로그 기능을 쓰되,
 *   화면 꾸밈은 한 곳에서 관리해 두 앱이 항상 똑같이 보이도록 하기 위해서입니다.
 * - aria-label, aria-live 같은 속성은 시각장애인용 화면 읽기 프로그램을 위한 표시입니다.
 */
import { initMainView } from './base.js';

// 내부 코드값을 사용자에게 보여줄 한국어 이름으로 바꾸는 표
const MODE_NAMES = {
  'semi-auto': '반자동',
  review: '확인 후 발행',
  'full-auto': '완전 자동',
  scheduled: '예약 발행',
};

/** 화면 맨 위에 표시할 '제작 4단계' 안내를 만든다. (키워드 → 생성 → 검토 → 저장/발행) */
function createBlogProcessGuide() {
  const guide = document.createElement('section');
  guide.className = 'creator-blog-process';
  guide.setAttribute('aria-label', '블로그 콘텐츠 제작 단계');
  guide.innerHTML = `
    <ol class="creator-blog-steps">
      <li>
        <span class="creator-blog-step-number">1</span>
        <span><strong>키워드 입력</strong><small>주제 정하기</small></span>
      </li>
      <li>
        <span class="creator-blog-step-number">2</span>
        <span><strong>콘텐츠 생성</strong><small>AI 초안 만들기</small></span>
      </li>
      <li>
        <span class="creator-blog-step-number">3</span>
        <span><strong>미리보기 및 검토</strong><small>내용 확인하기</small></span>
      </li>
      <li>
        <span class="creator-blog-step-number">4</span>
        <span><strong>저장 또는 발행</strong><small>선택한 방식으로 완료</small></span>
      </li>
    </ol>
  `;
  return guide;
}

/**
 * 이미 만들어진 블로그 화면에 안내 문구와 디자인 요소를 덧붙인다.
 * 맨 앞의 검사는 '중복 실행 방지'다. 화면을 여러 번 열어도 안내가 두 번 붙지 않게 한다.
 */
function decorateBlogView(container) {
  if (container.classList.contains('creator-blog-view')) return;

  container.classList.add('creator-blog-view');
  const sections = Array.from(container.children).filter((element) =>
    element.classList.contains('settings-section')
  );
  const [keywordCard, modeCard] = sections;

  keywordCard?.classList.add('creator-blog-keyword-card');
  const keywordTitle = keywordCard?.querySelector('h2');
  const keywordInput = container.querySelector('#keyword-input');
  const keywordActions = keywordCard?.querySelector('.keyword-actions');
  if (keywordTitle && keywordInput && keywordActions) {
    keywordTitle.id = 'creator-blog-keyword-title';
    keywordInput.setAttribute('aria-labelledby', keywordTitle.id);
    keywordInput.setAttribute('aria-describedby', 'creator-blog-keyword-help creator-blog-api-note');

    const keywordHelp = document.createElement('p');
    keywordHelp.id = 'creator-blog-keyword-help';
    keywordHelp.className = 'creator-blog-field-help';
    keywordHelp.textContent = '한 줄에 하나씩 키워드를 입력하세요.';
    keywordInput.before(keywordHelp);

    const apiNote = document.createElement('p');
    apiNote.id = 'creator-blog-api-note';
    apiNote.className = 'creator-blog-api-note';
    apiNote.textContent = '키워드 자동추천은 설정된 텍스트 AI API를 사용할 수 있습니다.';
    keywordActions.insertAdjacentElement('afterend', apiNote);
  }

  modeCard?.classList.add('creator-blog-mode-card');
  const modeTitle = modeCard?.querySelector('h2');
  const modeOptions = modeCard?.querySelector('.mode-options');
  if (modeTitle && modeOptions) {
    modeTitle.id = 'creator-blog-mode-title';
    modeOptions.setAttribute('role', 'radiogroup');
    modeOptions.setAttribute('aria-labelledby', modeTitle.id);
  }

  // 완전자동·예약발행은 실제로 글이 올라가는 모드이므로, 눈에 띄는 경고 문구를 붙인다.
  container.querySelectorAll('input[name="mode"]').forEach((radio) => {
    const option = radio.closest('.mode-option');
    option?.classList.add('creator-blog-mode-option');
    option?.setAttribute('data-mode', radio.value);
    if (radio.value === 'full-auto' || radio.value === 'scheduled') {
      option?.classList.add('creator-blog-mode-option-risk');
      const warning = document.createElement('span');
      warning.className = 'creator-blog-mode-warning';
      warning.textContent = radio.value === 'full-auto' ? '실제 발행 주의' : '실제 예약 등록 주의';
      option?.appendChild(warning);
    }
  });

  const actionRow = Array.from(container.children).find((element) =>
    element.querySelector?.('#btn-generate')
  );
  actionRow?.classList.add('creator-blog-actions');
  if (actionRow && modeCard) modeCard.appendChild(actionRow);

  if (actionRow) {
    const actionCopy = document.createElement('div');
    actionCopy.className = 'creator-blog-action-copy';
    actionCopy.innerHTML = `
      <h2>콘텐츠 생성</h2>
      <p>현재 선택: <strong class="creator-blog-current-mode"></strong></p>
    `;
    actionRow.prepend(actionCopy);

    const updateSelectedMode = () => {
      const selectedMode = container.querySelector('input[name="mode"]:checked')?.value;
      actionCopy.querySelector('.creator-blog-current-mode').textContent =
        MODE_NAMES[selectedMode] || '';
    };
    container.querySelectorAll('input[name="mode"]').forEach((radio) => {
      radio.addEventListener('change', updateSelectedMode);
    });
    updateSelectedMode();

    const safetyNotice = document.createElement('aside');
    safetyNotice.className = 'creator-blog-safety';
    safetyNotice.setAttribute('aria-label', '발행 전 확인 사항');
    safetyNotice.innerHTML = `
      <strong>발행 전 확인</strong>
      <p>완전 자동 및 예약 발행은 실제 네이버 계정 작업으로 이어질 수 있습니다. 계정과 발행 모드를 확인하세요.</p>
    `;
    actionRow.insertAdjacentElement('afterend', safetyNotice);
  }

  container.querySelector('#recommend-result')?.setAttribute('aria-live', 'polite');
  container.querySelector('#generate-error')?.setAttribute('aria-live', 'polite');
  container.querySelector('#progress-area')?.setAttribute('aria-live', 'polite');
  container.prepend(createBlogProcessGuide());
}

/**
 * 블로그 화면을 그린다. 두 앱 모두 이 함수 하나만 부르면 된다.
 * 순서: 기능 화면 만들기(initMainView) → 디자인·안내 덧붙이기(decorateBlogView)
 */
export function initStyledBlogView(container) {
  initMainView(container);
  decorateBlogView(container);
}
