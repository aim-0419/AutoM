/**
 * [인스타그램 카드 만들기 화면]
 *
 * 비개발자를 위한 설명:
 * - 사용 순서:
 *     1) 주제와 카드 장수(3~10장)를 입력하고 '카드 만들기'를 누른다
 *     2) 진행 상황이 단계별로 표시된다 (문구 작성 → 배경 생성 → 카드 합성)
 *     3) 완성된 카드와 게시 문구를 화면에서 확인한다
 *     4) 마음에 들면 '인스타그램에 발행' 버튼으로 바로 올리거나,
 *        저장된 폴더에서 파일을 꺼내 직접 올린다
 * - 실제 제작과 업로드는 프로그램 내부(백엔드)가 하고, 이 화면은 요청과 결과 표시만 담당합니다.
 */
import { escapeHtml } from '../../shared/lib/html.js';

// 카드 '생성' 진행 단계를 사용자가 읽을 수 있는 문구로 바꾸는 표
const STAGE_LABELS = {
  writing: '카드 내용 작성 중...',
  illustrating: '배경 이미지 생성 중...',
  rendering: '카드 PNG 합성 중...',
  done: '카드 묶음 생성 완료',
};

// 결과가 아직 없을 때(또는 생성에 실패했을 때) 결과 자리에 보여 줄 안내 화면.
// 생성 시작과 동시에 결과 영역을 비우기 때문에, 실패하면 이 안내를 다시 넣어 준다.
// (그러지 않으면 실패했을 때 결과 영역이 텅 빈 채로 남아 무엇을 해야 할지 알 수 없다)
const EMPTY_OUTPUT_HTML = `
  <section class="settings-section creator-instagram-empty" aria-labelledby="instagram-empty-title">
    <span class="creator-instagram-empty-mark" aria-hidden="true"></span>
    <h2 id="instagram-empty-title">카드 미리보기</h2>
    <p>카드를 생성하면 이미지와 캡션이 여기에 표시됩니다.</p>
  </section>
`;

// 화면마다 등록한 '진행 상황 알림' 구독을 기억해 두었다가, 화면을 다시 그릴 때 해제하는 데 쓴다.
const progressSubscriptions = new WeakMap();

// 인스타그램 '발행(업로드)' 진행 단계 문구
const PUBLISH_STAGE_LABELS = {
  opening: '인스타그램 작성 화면 여는 중...',
  uploading: '카드 이미지 업로드 중...',
  captioning: '캡션 입력 중...',
  publishing: '인스타그램에 공유 중...',
  verifying: '발행 결과 확인 중...',
  published: '인스타그램 발행 완료',
};

/**
 * 생성이 끝난 카드뉴스 결과를 화면에 보여준다.
 * 저장 위치, 카드 미리보기, 게시 문구, 해시태그, 그리고 발행 버튼이 함께 표시된다.
 */
export function renderOutput(container, content) {
  const area = container.querySelector('#instagram-output');
  area.innerHTML = `
    <section class="settings-section creator-instagram-result" aria-labelledby="instagram-result-title">
      <header class="creator-instagram-section-header">
        <div>
          <span class="creator-instagram-section-label">생성 결과</span>
          <h2 id="instagram-result-title">${escapeHtml(content.title)}</h2>
        </div>
        <span class="creator-instagram-complete-badge">로컬 저장 완료</span>
      </header>

      <dl class="creator-instagram-result-meta">
        <div>
          <dt>저장 위치</dt>
          <dd class="instagram-output-path">${escapeHtml(content.workDir)}</dd>
        </div>
        <div>
          <dt>해시태그</dt>
          <dd class="creator-instagram-tags">${content.tags
            .map((tag) => `#${escapeHtml(tag)}`)
            .join(' ')}</dd>
        </div>
      </dl>

      <div class="creator-instagram-caption-field">
        <label for="instagram-caption">게시물 캡션</label>
        <p id="instagram-caption-help">실제 발행 전에 문구와 해시태그를 확인하세요.</p>
        <textarea
          id="instagram-caption"
          class="instagram-caption"
          aria-describedby="instagram-caption-help"
        >${escapeHtml(content.captionText)}</textarea>
      </div>

      <aside class="creator-instagram-publish" aria-labelledby="instagram-publish-title">
        <div class="creator-instagram-publish-copy">
          <strong id="instagram-publish-title">인스타그램 발행</strong>
          <p>아래 버튼은 현재 카드와 캡션을 연결된 계정에 실제로 발행합니다.</p>
        </div>
        <button type="button" id="btn-publish-instagram">실제 발행</button>
        <span id="instagram-publish-result" class="test-result" role="status" aria-live="polite"></span>
      </aside>
      <div
        id="instagram-publish-progress"
        class="instagram-progress test-result"
        role="status"
        aria-live="polite"
      ></div>
    </section>

    <section class="settings-section creator-instagram-preview" aria-labelledby="instagram-preview-title">
      <header class="creator-instagram-section-header">
        <div>
          <span class="creator-instagram-section-label">미리보기</span>
          <h2 id="instagram-preview-title">카드 이미지</h2>
        </div>
        <span class="creator-instagram-card-total">${content.cards.length}장</span>
      </header>
      <div class="instagram-preview-grid">
        ${content.cards
          .map(
            (card) => `
              <article class="instagram-preview-card">
                <img src="${escapeHtml(card.fileUrl)}" alt="${escapeHtml(card.headline)}" />
                <div class="instagram-card-copy">
                  <strong>${escapeHtml(card.headline)}</strong>
                  <span>${escapeHtml(card.body)}</span>
                </div>
              </article>`
          )
          .join('')}
      </div>
    </section>
  `;

  const publishButton = area.querySelector('#btn-publish-instagram');
  const publishResultEl = area.querySelector('#instagram-publish-result');
  publishButton.addEventListener('click', async () => {
    const confirmed = window.confirm('현재 카드와 캡션을 인스타그램 계정에 실제로 발행할까요?');
    if (!confirmed) return;

    publishButton.disabled = true;
    publishResultEl.textContent = '발행 요청 중...';
    publishResultEl.className = 'test-result';
    try {
      const result = await window.api.publishInstagramCarousel({
        keyword: content.keyword,
        title: content.title,
        caption: area.querySelector('#instagram-caption').value.trim(),
        cards: content.cards.map((card) => ({ path: card.path })),
      });
      publishResultEl.textContent = result.message;
      publishResultEl.className = `test-result ${result.success ? 'success' : 'error'}`;
      // 발행을 여러 번 시도하면 '게시물 열기' 버튼이 계속 늘어나므로,
      // 이전에 만든 버튼이 있으면 지우고 항상 한 개만 남긴다.
      area.querySelector('.instagram-open-post')?.remove();
      if (result.url) {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'secondary instagram-open-post';
        link.textContent = '게시물 열기';
        link.addEventListener('click', () => window.api.historyOpenUrl(result.url));
        publishResultEl.insertAdjacentElement('afterend', link);
      }
    } catch (error) {
      publishResultEl.textContent = error.message || '인스타그램 발행 중 오류가 발생했습니다.';
      publishResultEl.className = 'test-result error';
    } finally {
      publishButton.disabled = false;
    }
  });
}

/**
 * [화면 그리기] 인스타그램 카드 만들기 화면 전체를 만든다.
 *
 * 구성: 제작 4단계 안내 → 계정 연결 상태 → 주제·카드 수 입력 →
 *       카드 만들기 버튼 → 진행 상황 → 결과 영역
 * 화면을 그린 뒤 로그인 상태를 확인해 표시하고, 각 버튼에 동작을 연결한다.
 */
export async function initInstagramView(container) {
  container.innerHTML = `
    <div class="instagram-layout creator-instagram-view">
      <section class="creator-instagram-process" aria-label="인스타그램 카드 제작 단계">
        <ol class="creator-instagram-steps">
          <li>
            <span class="creator-instagram-step-number">1</span>
            <span><strong>계정 확인</strong><small>연결 상태 확인</small></span>
          </li>
          <li>
            <span class="creator-instagram-step-number">2</span>
            <span><strong>주제 입력</strong><small>카드 방향 정하기</small></span>
          </li>
          <li>
            <span class="creator-instagram-step-number">3</span>
            <span><strong>카드 생성</strong><small>이미지와 캡션 준비</small></span>
          </li>
          <li>
            <span class="creator-instagram-step-number">4</span>
            <span><strong>검토 및 발행</strong><small>최종 내용 확인</small></span>
          </li>
        </ol>
      </section>

      <section class="settings-section creator-instagram-workspace" aria-labelledby="instagram-compose-title">
        <header class="creator-instagram-card-header">
          <div>
            <span class="creator-instagram-section-label">인스타그램</span>
            <h2 id="instagram-compose-title">인스타그램 카드</h2>
            <p>계정 상태를 확인하고 카드에서 다룰 주제와 이미지 수를 설정하세요.</p>
          </div>
        </header>

        <div class="creator-instagram-account" aria-labelledby="instagram-account-title">
          <div class="creator-instagram-account-heading">
            <h3 id="instagram-account-title">계정 연결</h3>
            <span class="creator-instagram-session-label">로그인 상태</span>
          </div>
          <div class="creator-instagram-session">
            <span id="instagram-session-status" role="status" aria-live="polite">확인 중...</span>
          </div>
          <div class="creator-instagram-account-actions">
            <button
              id="btn-instagram-login"
              type="button"
              class="secondary"
              aria-describedby="instagram-session-warning"
            >로그인</button>
            <button
              id="btn-instagram-reset"
              type="button"
              class="secondary"
              aria-describedby="instagram-session-warning"
            >초기화</button>
          </div>
          <p id="instagram-session-warning" class="creator-instagram-account-note">
            초기화하면 이 기기에 저장된 인스타그램 로그인 세션이 삭제됩니다.
          </p>
        </div>

        <div class="creator-instagram-compose">
          <div class="creator-instagram-field">
            <label for="instagram-keyword">주제</label>
            <p id="instagram-keyword-help">카드에서 다룰 핵심 주제를 입력하세요.</p>
            <textarea
              id="instagram-keyword"
              rows="4"
              placeholder="예: 작은 집 수납 공간 정리 방법"
              aria-describedby="instagram-keyword-help instagram-recommend-note"
            ></textarea>
          </div>

          <div class="instagram-keyword-actions">
            <button id="btn-recommend-instagram-keyword" type="button" class="secondary">키워드 자동추천</button>
            <span id="instagram-recommend-result" class="test-result" role="status" aria-live="polite"></span>
          </div>
          <p id="instagram-recommend-note" class="creator-instagram-api-note">
            키워드 자동추천은 설정된 텍스트 AI API를 사용할 수 있습니다.
          </p>

          <div class="creator-instagram-generate-row">
            <div class="creator-instagram-count-field">
              <label for="instagram-card-count">카드 수</label>
              <select
                id="instagram-card-count"
                class="instagram-card-count"
                aria-describedby="instagram-card-count-help"
              >
                ${[3, 4, 5, 6, 7, 8, 9, 10]
                  .map((count) => `<option value="${count}" ${count === 5 ? 'selected' : ''}>${count}장</option>`)
                  .join('')}
              </select>
              <span id="instagram-card-count-help">3장부터 10장까지</span>
            </div>

            <div class="creator-instagram-generate-action">
              <button id="btn-generate-instagram" type="button">카드 생성</button>
              <span id="instagram-result" class="test-result" role="status" aria-live="polite"></span>
            </div>
          </div>

          <div
            id="instagram-progress"
            class="instagram-progress test-result"
            role="status"
            aria-live="polite"
          ></div>
        </div>
      </section>

      <div id="instagram-output" class="creator-instagram-output">${EMPTY_OUTPUT_HTML}</div>
    </div>
  `;

  const button = container.querySelector('#btn-generate-instagram');
  const resultEl = container.querySelector('#instagram-result');
  const progressEl = container.querySelector('#instagram-progress');
  const sessionStatusEl = container.querySelector('#instagram-session-status');
  const loginButton = container.querySelector('#btn-instagram-login');
  const resetButton = container.querySelector('#btn-instagram-reset');
  const recommendButton = container.querySelector('#btn-recommend-instagram-keyword');
  const recommendResultEl = container.querySelector('#instagram-recommend-result');

  const refreshSessionStatus = async () => {
    const status = await window.api.instagramSessionStatus();
    sessionStatusEl.textContent = status.loggedIn
      ? status.username
        ? `연결됨 (@${status.username})`
        : '연결됨'
      : '연결 안 됨';
    sessionStatusEl.className = `test-result ${status.loggedIn ? 'success' : ''}`;
  };

  await refreshSessionStatus();

  loginButton.addEventListener('click', async () => {
    loginButton.disabled = true;
    resultEl.textContent = '열린 Chromium 창에서 로그인해 주세요.';
    resultEl.className = 'test-result';
    try {
      const result = await window.api.instagramLogin();
      resultEl.textContent = result.message;
      resultEl.className = `test-result ${result.success ? 'success' : 'error'}`;
      await refreshSessionStatus();
    } finally {
      loginButton.disabled = false;
    }
  });

  resetButton.addEventListener('click', async () => {
    resetButton.disabled = true;
    try {
      const result = await window.api.instagramResetSession();
      resultEl.textContent = result.message;
      resultEl.className = `test-result ${result.success ? 'success' : 'error'}`;
      await refreshSessionStatus();
    } finally {
      resetButton.disabled = false;
    }
  });

  recommendButton.addEventListener('click', async () => {
    // 블로그와 같은 추천 기능을 사용하며, 발행 기록에 있는 키워드는 추천 대상에서 제외한다.
    recommendButton.disabled = true;
    recommendResultEl.textContent = '추천 받는 중...';
    recommendResultEl.className = 'test-result';
    try {
      const result = await window.api.recommendKeyword();
      if (!result.success) {
        recommendResultEl.textContent = result.message;
        recommendResultEl.className = 'test-result error';
        return;
      }
      container.querySelector('#instagram-keyword').value = result.keyword;
      recommendResultEl.textContent = `추천됨: ${result.keyword}`;
      recommendResultEl.className = 'test-result success';
    } catch (error) {
      recommendResultEl.textContent = error.message || '키워드 추천에 실패했습니다.';
      recommendResultEl.className = 'test-result error';
    } finally {
      recommendButton.disabled = false;
    }
  });
  // 이 화면을 다시 그리게 되면 이전에 등록해 둔 '진행 상황 알림' 구독을 먼저 끊는다.
  // 끊지 않으면 같은 알림을 두 번 세 번 받아, 진행 문구가 엉뚱하게 덮어써진다.
  progressSubscriptions.get(container)?.();
  const unsubscribeCallbacks = [
    window.api.onInstagramProgress((progress) => {
      const label = STAGE_LABELS[progress.stage] || progress.stage;
      const counter = progress.total ? ` (${progress.current}/${progress.total})` : '';
      progressEl.textContent = `${label}${counter}`;
      progressEl.className = `instagram-progress test-result ${progress.stage === 'done' ? 'success' : ''}`;
    }),
    window.api.onInstagramPublishProgress((progress) => {
      const publishProgressEl = container.querySelector('#instagram-publish-progress');
      if (!publishProgressEl) return;
      publishProgressEl.textContent = PUBLISH_STAGE_LABELS[progress.stage] || progress.stage;
      publishProgressEl.className = `instagram-progress test-result ${progress.stage === 'published' ? 'success' : ''}`;
    }),
  ];
  progressSubscriptions.set(container, () => unsubscribeCallbacks.forEach((unsubscribe) => unsubscribe?.()));

  button.addEventListener('click', async () => {
    const keyword = container.querySelector('#instagram-keyword').value.trim();
    const cardCount = Number(container.querySelector('#instagram-card-count').value);
    if (!keyword) {
      resultEl.textContent = '주제를 입력해 주세요.';
      resultEl.className = 'test-result error';
      return;
    }

    button.disabled = true;
    resultEl.textContent = '생성 요청 중...';
    resultEl.className = 'test-result';
    progressEl.textContent = '';
    const outputArea = container.querySelector('#instagram-output');
    outputArea.innerHTML = EMPTY_OUTPUT_HTML;
    try {
      const result = await window.api.generateInstagramCarousel({ keyword, cardCount });
      if (!result.success) {
        resultEl.textContent = result.message;
        resultEl.className = 'test-result error';
        return;
      }
      resultEl.textContent = 'PNG 카드와 캡션이 저장되었습니다.';
      resultEl.className = 'test-result success';
      renderOutput(container, result.content);
    } catch (error) {
      resultEl.textContent = error.message || '인스타그램 카드 생성 중 오류가 발생했습니다.';
      resultEl.className = 'test-result error';
    } finally {
      button.disabled = false;
    }
  });
}
