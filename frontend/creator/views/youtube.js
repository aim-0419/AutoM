/**
 * YouTube 채널 정보와 영상 조건을 입력받고 생성 결과를 미리 보여 주는 화면이다.
 * 실제 파일 생성은 preload를 거쳐 백엔드 YouTube 기능에 요청한다.
 */
function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FORMAT_OPTIONS = {
  shorts: {
    durations: [
      [30, '30초'],
      [45, '45초'],
      [60, '60초'],
      [90, '90초'],
      [180, '3분'],
    ],
    sceneCounts: [4, 5, 6, 7, 8, 9, 10, 11, 12],
    defaults: { 30: 5, 45: 6, 60: 8, 90: 10, 180: 12 },
  },
  longform: {
    durations: [
      [180, '3분'],
      [300, '5분'],
      [480, '8분'],
    ],
    sceneCounts: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    defaults: { 180: 8, 300: 10, 480: 12 },
  },
};

const STAGE_LABELS = {
  writing: '대본과 장면 구성 작성 중...',
  illustrating: '장면 이미지 생성 중...',
  rendering: '영상 장면 합성 중...',
  encoding: '무음 영상 파일 만드는 중...',
  done: 'YouTube 프로젝트 생성 완료',
};

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (!minutes) return `${remainingSeconds}초`;
  return remainingSeconds ? `${minutes}분 ${remainingSeconds}초` : `${minutes}분`;
}

export function renderYoutubeOutput(container, content) {
  const output = container.querySelector('#youtube-output');
  const authenticityReport = content.authenticityReport || { comparedRecentCount: 0, checks: [], notice: '' };
  const statusLabels = { pass: '자동 확인', action: '보완 필요', manual: '직접 확인' };
  output.innerHTML = `
    <section class="settings-section youtube-result-section creator-youtube-result" aria-labelledby="youtube-result-title">
      <header class="creator-youtube-section-header">
        <div>
          <span class="creator-youtube-section-label">생성 결과</span>
          <h2 id="youtube-result-title">${escapeHtml(content.title)}</h2>
        </div>
        <span class="creator-youtube-complete-badge">로컬 저장 완료</span>
      </header>
      <div class="youtube-result-meta">
        <span>${escapeHtml(content.formatLabel)}</span>
        <span>${escapeHtml(formatDuration(content.durationSeconds))}</span>
        <span>${escapeHtml(content.resolution)}</span>
        <span>${content.scenes.length}개 장면</span>
      </div>

      <div class="creator-youtube-result-layout">
        <div class="creator-youtube-preview-pane">
          <h3 id="youtube-preview-title">영상 미리보기</h3>
          <div class="youtube-video-frame ${escapeHtml(content.format)}">
            <video
              controls
              preload="metadata"
              aria-labelledby="youtube-preview-title"
              poster="${escapeHtml(content.scenes[0]?.fileUrl || '')}"
              src="${escapeHtml(content.videoFileUrl)}"
            ></video>
          </div>
        </div>

        <div class="creator-youtube-result-summary">
          <div class="creator-youtube-output-location">
            <span>저장 위치</span>
            <strong class="youtube-output-path">${escapeHtml(content.workDir)}</strong>
          </div>
          <div class="youtube-review-status" aria-label="생성 결과 확인 항목">
            <span>직접 녹음 필요</span>
            <span>AI 사용 표시 확인</span>
            <span>사실 확인 ${content.factCheckNotes.length}건</span>
            <span>최근 영상 ${authenticityReport.comparedRecentCount}건 비교</span>
          </div>

          <aside class="creator-youtube-external-work" aria-labelledby="youtube-external-work-title">
            <span class="creator-youtube-warning-badge">직접 작업 필요</span>
            <strong id="youtube-external-work-title">외부 편집 및 업로드</strong>
            <p id="youtube-external-work-help">
              AutoM이 YouTube에 직접 업로드하지 않습니다. 결과를 확인한 후 외부 페이지에서 직접 편집하거나 업로드하세요.
            </p>
            <div class="field-row youtube-output-actions">
              <button
                type="button"
                id="btn-open-capcut"
                class="secondary"
                aria-describedby="youtube-external-work-help"
              >CapCut 편집 페이지 열기</button>
              <button
                type="button"
                id="btn-open-youtube-upload"
                class="secondary"
                aria-describedby="youtube-external-work-help"
              >YouTube 업로드 페이지 열기</button>
              <button type="button" id="btn-open-youtube-output" class="secondary">저장 폴더 열기</button>
            </div>
          </aside>
        </div>
      </div>
    </section>

    <section class="settings-section youtube-policy-section" aria-labelledby="youtube-policy-title">
      <header class="creator-youtube-section-header">
        <div>
          <span class="creator-youtube-section-label">검토 항목</span>
          <h2 id="youtube-policy-title">수익화 정책 검토</h2>
        </div>
      </header>
      <div class="youtube-policy-review">
        ${authenticityReport.checks
          .map(
            (check) => `
              <div class="youtube-policy-row">
                <span class="youtube-policy-state ${escapeHtml(check.status)}">${escapeHtml(
                  statusLabels[check.status] || check.status
                )}</span>
                <strong>${escapeHtml(check.label)}</strong>
                <p>${escapeHtml(check.detail)}</p>
              </div>`
          )
          .join('')}
      </div>
      <label class="preview-label" for="youtube-about-output">채널 소개 초안</label>
      <textarea id="youtube-about-output" class="youtube-about-output" readonly>${escapeHtml(
        content.channelAboutDraft || ''
      )}</textarea>
      <p class="youtube-policy-notice">${escapeHtml(authenticityReport.notice)}</p>
    </section>

    <section class="settings-section youtube-copy-section" aria-labelledby="youtube-copy-title">
      <header class="creator-youtube-section-header">
        <div>
          <span class="creator-youtube-section-label">문구 및 대본</span>
          <h2 id="youtube-copy-title">업로드 문구와 녹음 대본</h2>
        </div>
      </header>
      <label class="preview-label" for="youtube-title-output">제목</label>
      <textarea id="youtube-title-output" class="youtube-title-output" readonly>${escapeHtml(content.title)}</textarea>
      <label class="preview-label" for="youtube-description-output">설명과 태그</label>
      <textarea id="youtube-description-output" class="youtube-description-output" readonly>${escapeHtml(content.descriptionText)}</textarea>
      <label class="preview-label" for="youtube-script-output">녹음 대본</label>
      <textarea id="youtube-script-output" class="youtube-script-output" readonly>${escapeHtml(content.scriptText)}</textarea>
    </section>

    <section class="settings-section youtube-scene-section" aria-labelledby="youtube-scene-title">
      <header class="creator-youtube-section-header">
        <div>
          <span class="creator-youtube-section-label">장면별 결과</span>
          <h2 id="youtube-scene-title">장면 구성</h2>
        </div>
        <span class="creator-youtube-scene-total">${content.scenes.length}개 장면</span>
      </header>
      <div class="youtube-scene-grid ${escapeHtml(content.format)}">
        ${content.scenes
          .map(
            (scene) => `
              <article class="youtube-scene-item">
                <img src="${escapeHtml(scene.fileUrl)}" alt="${escapeHtml(scene.onScreenText)}" />
                <div class="youtube-scene-copy">
                  <strong>${String(scene.index).padStart(2, '0')}. ${escapeHtml(scene.onScreenText)}</strong>
                  <span>${escapeHtml(formatDuration(Math.round(scene.durationSeconds)))}</span>
                  <p>${escapeHtml(scene.narration)}</p>
                </div>
              </article>`
          )
          .join('')}
      </div>
    </section>
  `;

  output.querySelector('#btn-open-youtube-output').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await window.api.openYoutubeOutput(content.workDir);
      if (!result.success) window.alert(result.message);
    } finally {
      button.disabled = false;
    }
  });

  output.querySelector('#btn-open-capcut').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await window.api.openCapcutEditor();
      if (!result.success) window.alert(result.message);
    } finally {
      button.disabled = false;
    }
  });

  output.querySelector('#btn-open-youtube-upload').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await window.api.openYoutubeUploadPage();
      if (!result.success) window.alert(result.message);
    } finally {
      button.disabled = false;
    }
  });
}

export async function initYoutubeView(container) {
  container.innerHTML = `
    <div class="youtube-layout creator-youtube-view">
      <section class="creator-youtube-process" aria-labelledby="youtube-process-title">
        <header class="creator-youtube-process-header">
          <div>
            <strong id="youtube-process-title">유튜브 콘텐츠 제작 흐름</strong>
            <p>채널 기준부터 결과 확인까지 네 단계로 진행합니다.</p>
          </div>
          <span class="creator-youtube-warning-badge">직접 업로드 필요</span>
        </header>
        <ol class="creator-youtube-steps">
          <li>
            <span class="creator-youtube-step-number">1</span>
            <span><strong>채널 기준 설정</strong><small>주제와 시청자 정리</small></span>
          </li>
          <li>
            <span class="creator-youtube-step-number">2</span>
            <span><strong>영상 설정</strong><small>주제와 형식 선택</small></span>
          </li>
          <li>
            <span class="creator-youtube-step-number">3</span>
            <span><strong>AI 콘텐츠 생성</strong><small>대본·이미지·영상 준비</small></span>
          </li>
          <li>
            <span class="creator-youtube-step-number">4</span>
            <span><strong>확인 및 외부 작업</strong><small>직접 편집·업로드</small></span>
          </li>
        </ol>
        <p class="creator-youtube-upload-notice">
          AutoM은 YouTube 계정에 직접 업로드하지 않습니다. 생성 결과를 확인한 뒤 외부 편집 또는 업로드 페이지에서 직접 처리하세요.
        </p>
      </section>

      <div class="creator-youtube-workspace">
        <section class="settings-section youtube-profile-section creator-youtube-profile" aria-labelledby="youtube-profile-title">
          <header class="creator-youtube-section-header">
            <div>
              <span class="creator-youtube-section-label">1단계</span>
              <h2 id="youtube-profile-title">채널 기준</h2>
            </div>
          </header>
          <p id="youtube-profile-help" class="creator-youtube-section-help">
            매 영상에 공통으로 반영할 채널의 방향과 제작자 관점을 입력하세요.
          </p>
          <div class="field-row creator-youtube-field">
            <label for="youtube-channel-theme">채널 핵심 주제</label>
            <span id="youtube-channel-theme-help">채널이 지속적으로 다룰 핵심 분야</span>
            <input
              id="youtube-channel-theme"
              type="text"
              maxlength="200"
              placeholder="예: 일상에서 바로 쓰는 디지털 활용법"
              aria-describedby="youtube-channel-theme-help youtube-profile-help"
            />
          </div>
          <div class="field-row creator-youtube-field">
            <label for="youtube-target-audience">주요 시청자</label>
            <span id="youtube-target-audience-help">영상이 도움을 줄 주요 시청자</span>
            <input
              id="youtube-target-audience"
              type="text"
              maxlength="200"
              placeholder="예: 스마트폰과 AI 도구를 쉽게 배우고 싶은 일반 사용자"
              aria-describedby="youtube-target-audience-help youtube-profile-help"
            />
          </div>
          <div class="field-row youtube-profile-textarea-row creator-youtube-field">
            <label for="youtube-creator-perspective">제작자 관점·경험</label>
            <span id="youtube-creator-perspective-help">영상에 더할 실제 관점이나 직접 경험</span>
            <textarea
              id="youtube-creator-perspective"
              rows="4"
              maxlength="1000"
              placeholder="영상에 반영할 실제 관점이나 직접 겪은 내용을 입력하세요."
              aria-describedby="youtube-creator-perspective-help youtube-profile-help"
            ></textarea>
          </div>
        </section>

        <section class="settings-section creator-youtube-settings" aria-labelledby="youtube-settings-title">
          <header class="creator-youtube-section-header">
            <div>
              <span class="creator-youtube-section-label">2~3단계</span>
              <h2 id="youtube-settings-title">YouTube 영상</h2>
            </div>
          </header>

          <div class="field-row creator-youtube-field creator-youtube-keyword-field">
            <label for="youtube-keyword">영상 주제</label>
            <span id="youtube-keyword-help">이번 영상에서 다룰 주제 또는 키워드</span>
            <textarea
              id="youtube-keyword"
              rows="4"
              placeholder="예: 스마트폰 사진을 깔끔하게 정리하는 방법"
              aria-describedby="youtube-keyword-help youtube-recommend-note"
            ></textarea>
          </div>
          <div class="field-row youtube-keyword-actions">
            <button id="btn-recommend-youtube-keyword" type="button" class="secondary">키워드 자동추천</button>
            <span id="youtube-recommend-result" class="test-result" role="status" aria-live="polite"></span>
          </div>
          <p id="youtube-recommend-note" class="creator-youtube-api-note">
            키워드 자동추천은 설정된 텍스트 AI API를 사용할 수 있습니다.
          </p>

          <div class="creator-youtube-controls">
            <div class="field-row creator-youtube-control">
              <label for="youtube-format">영상 형식</label>
              <select id="youtube-format" class="youtube-control-select">
                <option value="shorts">쇼츠 9:16</option>
                <option value="longform">롱폼 16:9</option>
              </select>
            </div>
            <div class="field-row creator-youtube-control">
              <label for="youtube-duration">영상 길이</label>
              <select id="youtube-duration" class="youtube-control-select"></select>
            </div>
            <div class="field-row creator-youtube-control">
              <label for="youtube-scene-count">장면 수</label>
              <select id="youtube-scene-count" class="youtube-control-select"></select>
            </div>
            <div class="field-row creator-youtube-control">
              <label for="youtube-content-style">구성 방식</label>
              <select id="youtube-content-style" class="youtube-control-select">
                <option value="educational">정보형</option>
                <option value="problem-solving">문제 해결형</option>
                <option value="comparison">비교형</option>
                <option value="story">스토리형</option>
              </select>
            </div>
          </div>

          <div class="creator-youtube-generate">
            <div class="creator-youtube-generate-copy">
              <strong>AI 콘텐츠 생성</strong>
              <p>AI API가 호출될 수 있으며 이미지·영상 생성에는 시간이 걸릴 수 있습니다. 결과는 로컬 출력 폴더에 저장됩니다.</p>
            </div>
            <button id="btn-generate-youtube" type="button">영상과 대본 생성</button>
            <span id="youtube-result" class="test-result" role="status" aria-live="polite"></span>
          </div>
          <div
            id="youtube-progress"
            class="youtube-progress test-result"
            role="status"
            aria-live="polite"
          ></div>
        </section>
      </div>

      <div id="youtube-output" class="creator-youtube-output">
        <section class="settings-section creator-youtube-empty" aria-labelledby="youtube-empty-title">
          <span class="creator-youtube-empty-mark" aria-hidden="true"></span>
          <h2 id="youtube-empty-title">아직 생성된 유튜브 콘텐츠가 없습니다</h2>
          <p>채널 기준과 영상 설정을 입력한 후 콘텐츠 생성을 시작하세요.</p>
        </section>
      </div>
    </div>
  `;

  const formatSelect = container.querySelector('#youtube-format');
  const durationSelect = container.querySelector('#youtube-duration');
  const sceneCountSelect = container.querySelector('#youtube-scene-count');
  const generateButton = container.querySelector('#btn-generate-youtube');
  const resultEl = container.querySelector('#youtube-result');
  const progressEl = container.querySelector('#youtube-progress');
  const recommendButton = container.querySelector('#btn-recommend-youtube-keyword');
  const recommendResultEl = container.querySelector('#youtube-recommend-result');
  const channelThemeInput = container.querySelector('#youtube-channel-theme');
  const targetAudienceInput = container.querySelector('#youtube-target-audience');
  const creatorPerspectiveInput = container.querySelector('#youtube-creator-perspective');

  try {
    const state = await window.api.getSettings();
    const profile = state.settings?.youtubeProfile || {};
    channelThemeInput.value = profile.channelTheme || '';
    targetAudienceInput.value = profile.targetAudience || '';
    creatorPerspectiveInput.value = profile.creatorPerspective || '';
  } catch (error) {
    resultEl.textContent = error.message || '저장된 채널 기준을 불러오지 못했습니다.';
    resultEl.className = 'test-result error';
  }

  const updateSceneCount = () => {
    const options = FORMAT_OPTIONS[formatSelect.value];
    const duration = Number(durationSelect.value);
    const defaultSceneCount = options.defaults[duration] || options.sceneCounts[0];
    sceneCountSelect.innerHTML = options.sceneCounts
      .map((count) => `<option value="${count}" ${count === defaultSceneCount ? 'selected' : ''}>${count}개</option>`)
      .join('');
  };

  const updateDuration = () => {
    const options = FORMAT_OPTIONS[formatSelect.value];
    durationSelect.innerHTML = options.durations
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join('');
    updateSceneCount();
  };

  formatSelect.addEventListener('change', updateDuration);
  durationSelect.addEventListener('change', updateSceneCount);
  updateDuration();

  recommendButton.addEventListener('click', async () => {
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
      container.querySelector('#youtube-keyword').value = result.keyword;
      recommendResultEl.textContent = `추천됨: ${result.keyword}`;
      recommendResultEl.className = 'test-result success';
    } catch (error) {
      recommendResultEl.textContent = error.message || '키워드 추천에 실패했습니다.';
      recommendResultEl.className = 'test-result error';
    } finally {
      recommendButton.disabled = false;
    }
  });

  const removeProgressListener = window.api.onYoutubeProgress((progress) => {
    const label = STAGE_LABELS[progress.stage] || progress.stage;
    const counter = progress.total ? ` (${progress.current}/${progress.total})` : '';
    progressEl.textContent = `${label}${counter}`;
    progressEl.className = `youtube-progress test-result ${progress.stage === 'done' ? 'success' : ''}`;
  });

  generateButton.addEventListener('click', async () => {
    const keyword = container.querySelector('#youtube-keyword').value.trim();
    const channelTheme = channelThemeInput.value.trim();
    const targetAudience = targetAudienceInput.value.trim();
    const creatorPerspective = creatorPerspectiveInput.value.trim();
    if (channelTheme.length < 5 || targetAudience.length < 5) {
      resultEl.textContent = '채널 핵심 주제와 주요 시청자를 각각 5자 이상 입력해 주세요.';
      resultEl.className = 'test-result error';
      return;
    }
    if (!keyword) {
      resultEl.textContent = '주제를 입력해 주세요.';
      resultEl.className = 'test-result error';
      return;
    }

    generateButton.disabled = true;
    resultEl.textContent = '생성 요청 중...';
    resultEl.className = 'test-result';
    progressEl.textContent = '';
    container.querySelector('#youtube-output').innerHTML = '';
    try {
      const result = await window.api.generateYoutubeProject({
        keyword,
        format: formatSelect.value,
        durationSeconds: Number(durationSelect.value),
        sceneCount: Number(sceneCountSelect.value),
        contentStyle: container.querySelector('#youtube-content-style').value,
        channelTheme,
        targetAudience,
        creatorPerspective,
      });
      if (!result.success) {
        resultEl.textContent = result.message;
        resultEl.className = 'test-result error';
        return;
      }
      resultEl.textContent = '영상, 대본, 자막 파일이 저장되었습니다.';
      resultEl.className = 'test-result success';
      renderYoutubeOutput(container, result.content);
    } catch (error) {
      resultEl.textContent = error.message || 'YouTube 영상 생성 중 오류가 발생했습니다.';
      resultEl.className = 'test-result error';
    } finally {
      generateButton.disabled = false;
    }
  });

  void removeProgressListener;
}
