// 완전자동은 실제 글을 바로 발행하므로, 앱을 켠 뒤 처음 선택할 때만 확인창을 띄운다.
let fullAutoWarningShown = false;
let scheduledWarningShown = false;

const SCHEDULE_MIN_LEAD_MINUTES = 20;
const SCHEDULE_MINUTE_STEP = 10;
const SCHEDULE_MAX_DAYS = 365;

const STAGE_LABELS = {
  // 화면의 진행 상황에 표시되는 문구다.
  // 내부 코드는 text/image/done 같은 짧은 이름을 쓰고, 사용자는 한글 상태를 본다.
  text: '글 생성 중...',
  image: '이미지 생성 중...',
  done: '완료',
  publishing: '네이버 발행 중...',
  published: '발행 완료',
  scheduling: '네이버 예약 등록 중...',
  scheduled: '예약 등록 완료',
  cancelled: '중단됨',
  error: '실패',
};

function normalizeErrorMessage(value, fallback = '오류가 발생했습니다.') {
  // Electron 내부 오류 문구는 개발자용 표현이 섞여 길게 보일 수 있다.
  // 사용자에게는 실제 원인만 보이도록 앞부분의 기술 문구를 제거한다.
  const raw = typeof value === 'string' ? value : value?.message;
  if (!raw) {
    return fallback;
  }

  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();
}

function escapeHtml(str) {
  // 제목·본문처럼 사용자가 입력한 문장을 HTML로 표시할 때 태그로 실행되지 않게 문자로 바꾼다.
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

function formatPreviewInlineText(line) {
  // 미리보기에서는 **굵게** 표시와 URL만 HTML 서식으로 바꾸고, 나머지 글은 안전하게 그대로 보여 준다.
  const bolded = escapeHtml(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return bolded.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noreferrer noopener">$1</a>');
}

function renderPreviewHtml(body, images) {
  // AI 본문의 표시 규칙을 사람이 보는 미리보기 규칙으로 바꾼다.
  // [IMAGE_n]은 이미지로, ##은 소제목으로, URL은 클릭 가능한 링크로 보인다.
  const imageMap = new Map(images.map((image) => [Number(image.index), image]));
  return body
    .split('\n')
    .map((line) => {
      const imageMatch = line.trim().match(/^\[IMAGE_(\d+)\]$/);
      if (imageMatch && imageMap.has(Number(imageMatch[1]))) {
        const image = imageMap.get(Number(imageMatch[1]));
        return `<img src="${escapeAttr(image.fileUrl)}" alt="이미지 ${image.index}" class="preview-image" />`;
      }
      if (line.startsWith('## ')) {
        return `<h3>${escapeHtml(line.slice(3))}</h3>`;
      }
      if (line.trim() === '') {
        return '';
      }
      return `<p>${formatPreviewInlineText(line)}</p>`;
    })
    .join('\n');
}

function renderQualitySummary(report) {
  // 생성 직후 검사한 결과를 미리보기 위에 요약해, 발행 전에 바로 확인할 수 있게 한다.
  // 오류는 발행을 막고, 경고는 사용자가 자연스러움을 검토할 수 있도록 알려 준다.
  if (!report) {
    return '';
  }
  const metrics = report.metrics || {};
  const hasWarnings = (report.warnings || []).length > 0;
  const statusClass = report.passed ? (hasWarnings ? 'caution' : 'pass') : 'fail';
  const statusText = report.passed ? (hasWarnings ? '통과, 확인 권장 항목 있음' : '통과') : '발행 중단 항목 있음';
  const issues = [...(report.errors || []), ...(report.warnings || [])];
  const issueHtml = issues.length
    ? `<ul>${issues.map((item) => `<li>${escapeHtml(item.message)}</li>`).join('')}</ul>`
    : '';

  return `
    <div class="quality-summary ${statusClass}" id="quality-summary">
      <div class="quality-summary-title">자동 품질 점검: ${statusText}</div>
      <div class="quality-metrics">
        제목 ${metrics.titleChars ?? 0}자 · 본문 ${metrics.bodyChars ?? 0}자 · 소제목 ${metrics.headings ?? 0}개 ·
        이미지 ${metrics.images ?? 0}개 · 태그 ${metrics.tags ?? 0}개 · 내부링크 ${metrics.internalLinks ?? 0}개
      </div>
      ${issueHtml}
    </div>
  `;
}

function roundUpToTenMinutes(date) {
  const rounded = new Date(date);
  rounded.setSeconds(0, 0);
  const remainder = rounded.getMinutes() % SCHEDULE_MINUTE_STEP;
  if (remainder > 0) {
    rounded.setMinutes(rounded.getMinutes() + SCHEDULE_MINUTE_STEP - remainder);
  }
  return rounded;
}

function getScheduleBounds() {
  return {
    minimum: roundUpToTenMinutes(new Date(Date.now() + SCHEDULE_MIN_LEAD_MINUTES * 60 * 1000)),
    maximum: new Date(Date.now() + SCHEDULE_MAX_DAYS * 24 * 60 * 60 * 1000),
  };
}

function populateSelectOptions(select, values, selectedValue) {
  select.replaceChildren();
  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = String(value).padStart(2, '0');
    option.textContent = String(value).padStart(2, '0');
    option.selected = Number(value) === Number(selectedValue);
    select.appendChild(option);
  });
}

function updateScheduleDayOptions(container, preferredDay) {
  const { maximum } = getScheduleBounds();
  const today = new Date();
  const year = Number(container.querySelector('#schedule-year').value);
  const month = Number(container.querySelector('#schedule-month').value);
  const daySelect = container.querySelector('#schedule-day');
  const daysInMonth = new Date(year, month, 0).getDate();
  const minimumDay =
    year === today.getFullYear() && month === today.getMonth() + 1 ? today.getDate() : 1;
  const maximumDay =
    year === maximum.getFullYear() && month === maximum.getMonth() + 1
      ? maximum.getDate()
      : daysInMonth;
  const selectedDay = Math.min(Math.max(Number(preferredDay || daySelect.value || minimumDay), minimumDay), maximumDay);

  populateSelectOptions(
    daySelect,
    Array.from({ length: maximumDay - minimumDay + 1 }, (_, index) => minimumDay + index),
    selectedDay
  );
}

function updateScheduleMonthOptions(container, preferredMonth, preferredDay) {
  const { maximum } = getScheduleBounds();
  const today = new Date();
  const year = Number(container.querySelector('#schedule-year').value);
  const monthSelect = container.querySelector('#schedule-month');
  const minimumMonth = year === today.getFullYear() ? today.getMonth() + 1 : 1;
  const maximumMonth = year === maximum.getFullYear() ? maximum.getMonth() + 1 : 12;
  const selectedMonth = Math.min(
    Math.max(Number(preferredMonth || monthSelect.value || minimumMonth), minimumMonth),
    maximumMonth
  );

  populateSelectOptions(
    monthSelect,
    Array.from({ length: maximumMonth - minimumMonth + 1 }, (_, index) => minimumMonth + index),
    selectedMonth
  );
  updateScheduleDayOptions(container, preferredDay);
}

function getScheduleValue(container) {
  const getValue = (id) => container.querySelector(id).value;
  return `${getValue('#schedule-year')}-${getValue('#schedule-month')}-${getValue('#schedule-day')}T${getValue('#schedule-hour')}:${getValue('#schedule-minute')}`;
}

function initializeScheduleControl(container) {
  // 기본 예약 시각은 글과 이미지를 생성할 시간을 고려해 현재보다 한 시간 뒤로 둔다.
  const { maximum } = getScheduleBounds();
  const suggested = roundUpToTenMinutes(new Date(Date.now() + 60 * 60 * 1000));
  const yearSelect = container.querySelector('#schedule-year');
  const monthSelect = container.querySelector('#schedule-month');
  const daySelect = container.querySelector('#schedule-day');
  const hourSelect = container.querySelector('#schedule-hour');
  const minuteSelect = container.querySelector('#schedule-minute');

  container.querySelector('label[for="schedule-start"]').htmlFor = 'schedule-year';
  populateSelectOptions(
    yearSelect,
    Array.from(
      { length: maximum.getFullYear() - suggested.getFullYear() + 1 },
      (_, index) => suggested.getFullYear() + index
    ),
    suggested.getFullYear()
  );
  updateScheduleMonthOptions(container, suggested.getMonth() + 1, suggested.getDate());
  populateSelectOptions(hourSelect, Array.from({ length: 24 }, (_, index) => index), suggested.getHours());
  populateSelectOptions(minuteSelect, [0, 10, 20, 30, 40, 50], suggested.getMinutes());

  yearSelect.addEventListener('change', () => {
    updateScheduleMonthOptions(container, monthSelect.value, daySelect.value);
  });
  monthSelect.addEventListener('change', () => updateScheduleDayOptions(container, daySelect.value));
}

function syncScheduleVisibility(container) {
  const mode = container.querySelector('input[name="mode"]:checked')?.value;
  container.querySelector('#schedule-options').hidden = mode !== 'scheduled';
}

export function initMainView(container) {
  // 메인 화면 전체를 그린다.
  // 사용자는 여기서 키워드를 입력하고, 발행 방식(반자동/확인 후 발행/완전자동)을 고른다.
  container.innerHTML = `
    <div class="settings-section">
      <h2>키워드 입력</h2>
      <textarea id="keyword-input" rows="4" placeholder="한 줄에 하나씩 키워드를 입력하세요 (예: 초보 홈카페 원두 고르기)"></textarea>
      <div class="keyword-actions">
        <button type="button" id="btn-recommend-keyword" class="secondary">키워드 자동추천</button>
        <span class="test-result" id="recommend-result"></span>
      </div>
    </div>

    <div class="settings-section">
      <h2>발행 모드</h2>
      <div class="mode-options">
        <label class="mode-option">
          <input type="radio" name="mode" value="semi-auto" checked />
          반자동 <span class="hint-inline">생성만 하고 발행하지 않습니다.</span>
        </label>
        <label class="mode-option">
          <input type="radio" name="mode" value="review" />
          확인 후 발행 <span class="hint-inline">미리보기에서 검토 후 [발행]을 누르면 게시합니다.</span>
        </label>
        <label class="mode-option">
          <input type="radio" name="mode" value="full-auto" />
          완전자동 <span class="hint-inline">생성 즉시 발행합니다. 계정 제재 위험이 있습니다.</span>
        </label>
        <label class="mode-option">
          <input type="radio" name="mode" value="scheduled" />
          예약발행 <span class="hint-inline">선택한 시각부터 네이버 서버에 예약 등록합니다.</span>
        </label>
      </div>
      <div class="schedule-options" id="schedule-options" hidden>
        <div class="field-row">
          <label for="schedule-start">첫 예약 시각</label>
          <div class="schedule-picker" role="group" aria-label="첫 예약 시각">
            <div class="schedule-select-group">
              <select id="schedule-year" class="schedule-select schedule-year" aria-label="예약 연도"></select><span>년</span>
              <select id="schedule-month" class="schedule-select schedule-month" aria-label="예약 월"></select><span>월</span>
              <select id="schedule-day" class="schedule-select schedule-day" aria-label="예약 일"></select><span>일</span>
            </div>
            <div class="schedule-select-group">
              <select id="schedule-hour" class="schedule-select schedule-time" aria-label="예약 시"></select><span>시</span>
              <select id="schedule-minute" class="schedule-select schedule-time" aria-label="예약 분"></select><span>분</span>
            </div>
          </div>
        </div>
        <div class="schedule-help">여러 키워드는 설정 탭의 자동·예약 발행 간격만큼 순서대로 예약됩니다.</div>
      </div>
    </div>

    <div class="field-row">
      <button type="button" id="btn-generate">생성 시작</button>
      <button type="button" id="btn-cancel" class="secondary" hidden>작업 중단</button>
      <span class="test-result" id="generate-error"></span>
    </div>

    <div id="progress-area"></div>
    <div id="results-area"></div>
    <div id="preview-area"></div>
  `;

  initializeScheduleControl(container);
  syncScheduleVisibility(container);
  wireEvents(container);
}

function wireEvents(container) {
  // 메인 화면 버튼과 선택 항목에 실제 동작을 연결한다.
  container.querySelectorAll('input[name="mode"]').forEach((radio) => {
    radio.addEventListener('change', (event) => {
      if (event.target.value === 'full-auto' && !fullAutoWarningShown) {
        // 완전자동은 사용자가 글을 검토하지 않고 바로 발행하므로 처음 선택할 때 한 번 더 확인한다.
        const confirmed = window.confirm(
          '완전자동 모드는 생성 즉시 네이버에 발행합니다.\n계정 보호를 위해 발행 간격이 적용되며, 자동 발행은 계정 제재 위험이 있습니다.\n계속하시겠습니까?'
        );
        if (!confirmed) {
          container.querySelector('input[name="mode"][value="semi-auto"]').checked = true;
          syncScheduleVisibility(container);
          return;
        }
        fullAutoWarningShown = true;
      }

      if (event.target.value === 'scheduled' && !scheduledWarningShown) {
        const confirmed = window.confirm(
          '예약발행 모드는 생성한 글을 네이버 서버에 실제 예약 등록합니다.\n여러 키워드는 설정된 발행 간격만큼 나누어 예약됩니다.\n계속하시겠습니까?'
        );
        if (!confirmed) {
          container.querySelector('input[name="mode"][value="semi-auto"]').checked = true;
          syncScheduleVisibility(container);
          return;
        }
        scheduledWarningShown = true;
      }
      syncScheduleVisibility(container);
    });
  });

  container.querySelector('#btn-generate').addEventListener('click', () => handleGenerateClick(container));
  container.querySelector('#btn-recommend-keyword').addEventListener('click', () => handleRecommendClick(container));
  container.querySelector('#btn-cancel').addEventListener('click', async () => {
    // 취소를 누르면 메인 프로그램에 요청하고, 현재 AI 호출이 끝나는 안전한 시점에 중단된다.
    const button = container.querySelector('#btn-cancel');
    const resultEl = container.querySelector('#generate-error');
    button.disabled = true;
    try {
      const result = await window.api.cancelBatch();
      resultEl.textContent = normalizeErrorMessage(result.message);
      resultEl.className = `test-result ${result.success ? '' : 'error'}`;
    } catch (err) {
      resultEl.textContent = normalizeErrorMessage(err, '작업 중단 요청에 실패했습니다.');
      resultEl.className = 'test-result error';
    }
  });
}

async function handleRecommendClick(container) {
  // 키워드 자동추천 버튼을 눌렀을 때 실행된다.
  // 이미 사용한 키워드는 제외하고 새 키워드를 추천받아 입력칸에 추가한다.
  const btn = container.querySelector('#btn-recommend-keyword');
  const resultEl = container.querySelector('#recommend-result');
  btn.disabled = true;
  resultEl.textContent = '추천 받는 중...';
  resultEl.className = 'test-result';

  try {
    const result = await window.api.recommendKeyword();
    if (!result.success) {
      resultEl.textContent = normalizeErrorMessage(result.message);
      resultEl.className = 'test-result error';
      return;
    }

    const textarea = container.querySelector('#keyword-input');
    const current = textarea.value.trim();
    textarea.value = current ? `${current}\n${result.keyword}` : result.keyword;
    resultEl.textContent = `추천됨: ${result.keyword}`;
    resultEl.className = 'test-result success';
  } catch (err) {
    resultEl.textContent = normalizeErrorMessage(err, '키워드 추천에 실패했습니다.');
    resultEl.className = 'test-result error';
  } finally {
    btn.disabled = false;
  }
}

function getKeywords(container) {
  // 입력칸에는 여러 키워드를 줄바꿈으로 넣을 수 있다.
  // 빈 줄은 제외하고 실제 키워드만 목록으로 만든다.
  return container
    .querySelector('#keyword-input')
    .value.split('\n')
    .map((k) => k.trim())
    .filter(Boolean);
}

async function handleGenerateClick(container) {
  // [생성 시작] 버튼의 전체 흐름이다.
  // 1. 키워드가 있는지 확인한다.
  // 2. 이전에 발행한 키워드인지 확인한다.
  // 3. 선택한 모드에 맞춰 글 생성/미리보기/발행을 진행한다.
  const errorEl = container.querySelector('#generate-error');
  errorEl.textContent = '';

  const keywords = getKeywords(container);
  if (keywords.length === 0) {
    errorEl.textContent = '키워드를 한 개 이상 입력해주세요.';
    errorEl.className = 'test-result error';
    return;
  }

  const normalizedKeywords = keywords.map((keyword) => keyword.normalize('NFKC').toLocaleLowerCase('ko-KR'));
  if (new Set(normalizedKeywords).size !== normalizedKeywords.length) {
    errorEl.textContent = '같은 키워드가 두 번 이상 입력되어 있습니다. 중복 항목을 제거해주세요.';
    errorEl.className = 'test-result error';
    return;
  }

  const mode = container.querySelector('input[name="mode"]:checked').value;
  const isAutomatedPublishing = mode === 'full-auto' || mode === 'scheduled';
  const usedKeywords = isAutomatedPublishing
    ? await window.api.getPublishedKeywords()
    : await window.api.getUsedKeywords();
  const usedSet = new Set(usedKeywords.map((keyword) => keyword.normalize('NFKC').toLocaleLowerCase('ko-KR')));
  const duplicates = keywords.filter((keyword) => usedSet.has(keyword.normalize('NFKC').toLocaleLowerCase('ko-KR')));
  if (duplicates.length > 0) {
    if (isAutomatedPublishing) {
      errorEl.textContent = '자동·예약 발행에서는 이미 등록한 키워드를 다시 사용할 수 없습니다.';
      errorEl.className = 'test-result error';
      return;
    }
    // 같은 키워드를 반복 발행하면 블로그 품질에 좋지 않을 수 있으므로 사용자에게 확인받는다.
    const proceed = window.confirm(
      `다음 키워드는 이미 발행한 적이 있습니다:\n${duplicates.join(', ')}\n\n그래도 계속하시겠습니까?`
    );
    if (!proceed) {
      return;
    }
  }

  if (isAutomatedPublishing && keywords.length > 3) {
    errorEl.textContent = '자동·예약 발행은 대량 등록 위험을 줄이기 위해 한 번에 최대 3개까지만 실행할 수 있습니다.';
    errorEl.className = 'test-result error';
    return;
  }

  let scheduleAt = null;
  if (mode === 'scheduled') {
    const selectedScheduleValue = getScheduleValue(container);
    const selectedTime = new Date(selectedScheduleValue);
    const minimumTime = Date.now() + SCHEDULE_MIN_LEAD_MINUTES * 60 * 1000;
    if (Number.isNaN(selectedTime.getTime())) {
      errorEl.textContent = '첫 예약 날짜와 시간을 선택해주세요.';
      errorEl.className = 'test-result error';
      return;
    }
    if (selectedTime.getTime() < minimumTime) {
      errorEl.textContent = `예약 시각은 현재보다 최소 ${SCHEDULE_MIN_LEAD_MINUTES}분 이후로 설정해주세요.`;
      errorEl.className = 'test-result error';
      return;
    }
    scheduleAt = selectedScheduleValue;
  }
  const generateButton = container.querySelector('#btn-generate');
  const cancelButton = container.querySelector('#btn-cancel');

  container.querySelector('#results-area').innerHTML = '';
  container.querySelector('#preview-area').innerHTML = '';
  renderProgress(container, keywords);

  generateButton.disabled = true;
  cancelButton.hidden = false;
  cancelButton.disabled = false;
  // 메인 프로세스가 "글 생성 중", "이미지 생성 중", "완료" 같은 진행 상황을 보내면 화면에 반영한다.
  const removeProgressListener = window.api.onPipelineProgress((data) => updateProgressRow(container, data));

  try {
    const { results } = await window.api.generateBatch({ keywords, mode, scheduleAt });
    renderResults(container, results, mode);
  } catch (err) {
    errorEl.textContent = normalizeErrorMessage(err, '생성 중 오류가 발생했습니다.');
    errorEl.className = 'test-result error';
    markProgressFailed(container);
  } finally {
    removeProgressListener();
    generateButton.disabled = false;
    cancelButton.hidden = true;
    cancelButton.disabled = false;
  }
}

function renderProgress(container, keywords) {
  // 키워드가 여러 개면 각각의 진행 상태를 한 줄씩 보여준다.
  const area = container.querySelector('#progress-area');
  area.innerHTML = `
    <div class="settings-section">
      <h2>진행 상황</h2>
      <div id="progress-rows">
        ${keywords
          .map(
            (k, i) => `
              <div class="progress-row">
                <span class="progress-keyword">${escapeHtml(k)}</span>
                <span class="progress-stage" id="progress-stage-${i}">대기 중</span>
              </div>
            `
          )
          .join('')}
      </div>
    </div>
  `;
}

function formatRemaining(totalSeconds) {
  // 자동발행 대기 시간을 "몇 분 몇 초" 형태로 바꿔 화면에 표시한다.
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}분 ${seconds}초`;
}

function updateProgressRow(container, data) {
  // 한 키워드의 상태가 바뀔 때마다 해당 줄의 문구를 갱신한다.
  // 완전자동 여러 건 발행 중 대기 시간이 있으면 남은 시간도 여기에 표시된다.
  const el = container.querySelector(`#progress-stage-${data.index}`);
  if (!el) {
    return;
  }
  el.classList.remove('success', 'error');
  if (data.stage === 'waiting') {
    el.textContent = `다음 발행까지 대기 중 (${formatRemaining(data.remainingSeconds)})`;
    return;
  }
  el.textContent = STAGE_LABELS[data.stage] || data.stage;
  if (data.stage === 'done' || data.stage === 'published' || data.stage === 'scheduled') {
    el.classList.add('success');
  } else if (data.stage === 'error' || data.stage === 'cancelled') {
    el.classList.add('error');
  }
}

function markProgressFailed(container) {
  // 생성 시작 후 중간에 오류가 나면, 대기 중으로 남겨두지 않고 실패 상태로 명확히 바꾼다.
  container.querySelectorAll('.progress-stage').forEach((el) => {
    if (el.textContent !== STAGE_LABELS.done) {
      el.textContent = '실패';
      el.classList.remove('success');
      el.classList.add('error');
    }
  });
}

function renderResults(container, results, mode) {
  // 생성이 끝난 뒤 결과 목록을 그린다.
  // 완전자동은 발행 결과 메시지를 보여주고, 나머지 모드는 미리보기 버튼을 보여준다.
  const area = container.querySelector('#results-area');
  area.innerHTML = `
    <div class="settings-section">
      <h2>결과</h2>
      <div id="results-rows"></div>
    </div>
  `;
  const rowsEl = area.querySelector('#results-rows');

  results.forEach((result) => {
    const row = document.createElement('div');
    row.className = 'result-row';

    if (result.status === 'error') {
      row.innerHTML = `
        <span class="result-keyword">${escapeHtml(result.keyword)}</span>
        <span class="test-result error">${escapeHtml(normalizeErrorMessage(result.message))}</span>
      `;
    } else if (mode === 'full-auto' || mode === 'scheduled') {
      const publishClass = result.publish?.success ? 'success' : 'error';
      row.innerHTML = `
        <span class="result-keyword">${escapeHtml(result.content.title)}</span>
        <span class="test-result ${publishClass}">${escapeHtml(result.publish?.message || '')}</span>
      `;
    } else {
      const label = document.createElement('span');
      label.className = 'result-keyword';
      label.textContent = result.content.title;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = '미리보기';
      button.addEventListener('click', () => renderPreview(container, result.content, mode));

      row.appendChild(label);
      row.appendChild(button);
    }

    rowsEl.appendChild(row);
  });

  const firstOk = results.find((r) => r.status !== 'error');
  if (mode !== 'full-auto' && mode !== 'scheduled' && firstOk) {
    renderPreview(container, firstOk.content, mode);
  }
}

function renderPreview(container, content, mode) {
  // 확인 후 발행/반자동 모드에서 사용자가 글을 검토하고 수정하는 영역이다.
  // 왼쪽은 원문 편집, 오른쪽은 실제 블로그처럼 보이는 미리보기다.
  const area = container.querySelector('#preview-area');
  area.innerHTML = `
    <div class="settings-section">
      <h2>미리보기 / 수정</h2>
      ${renderQualitySummary(content.qualityReport)}
      <div class="field-row">
        <label>제목</label>
        <input type="text" id="preview-title" value="${escapeAttr(content.title)}" />
      </div>
      <div class="preview-grid">
        <div>
          <label class="preview-label">본문 (마크다운, [IMAGE_n] 마커 포함)</label>
          <textarea id="preview-body" rows="18">${escapeHtml(content.body)}</textarea>
        </div>
        <div>
          <label class="preview-label">미리보기</label>
          <div class="preview-render" id="preview-render"></div>
        </div>
      </div>
      <div class="field-row">
        <label>태그</label>
        <span>${content.tags.map((t) => `#${escapeHtml(t)}`).join(' ')}</span>
      </div>
      <div class="field-row">
        <label></label>
        <button type="button" id="btn-preview-action">${mode === 'semi-auto' ? '폴더에 저장' : '발행'}</button>
        <span class="test-result" id="preview-action-result"></span>
      </div>
    </div>
  `;

  const bodyTextarea = area.querySelector('#preview-body');
  const titleInput = area.querySelector('#preview-title');
  const renderPane = area.querySelector('#preview-render');
  const updateRenderedPreview = () => {
    // 본문을 고칠 때마다 오른쪽 미리보기도 즉시 같은 내용으로 갱신한다.
    renderPane.innerHTML = renderPreviewHtml(bodyTextarea.value, content.images);
  };
  updateRenderedPreview();
  const markQualityForRecheck = () => {
    // 생성 당시의 품질 검사는 수정 전 결과다.
    // 제목이나 본문을 바꾸면 발행 직전에 다시 검사된다는 사실을 명확히 표시한다.
    const summary = area.querySelector('#quality-summary');
    if (!summary || summary.classList.contains('modified')) {
      return;
    }
    summary.className = 'quality-summary modified';
    summary.querySelector('.quality-summary-title').textContent = '내용이 수정되었습니다. 발행할 때 자동으로 다시 점검합니다.';
  };
  bodyTextarea.addEventListener('input', () => {
    updateRenderedPreview();
    markQualityForRecheck();
  });
  titleInput.addEventListener('input', markQualityForRecheck);

  area.querySelector('#btn-preview-action').addEventListener('click', async () => {
    // 반자동이면 폴더에 저장하고, 확인 후 발행이면 네이버에 실제 게시한다.
    const resultEl = area.querySelector('#preview-action-result');
    const actionButton = area.querySelector('#btn-preview-action');
    const title = titleInput.value.trim();
    const body = bodyTextarea.value;

    if (!title || !body.trim()) {
      resultEl.textContent = '제목과 본문을 모두 입력해주세요.';
      resultEl.className = 'test-result error';
      return;
    }

    actionButton.disabled = true;
    resultEl.textContent = '처리 중...';
    resultEl.className = 'test-result';

    try {
      if (mode === 'semi-auto') {
        const saveResult = await window.api.saveToFolder({
          keyword: content.keyword,
          workDir: content.workDir,
          title,
          body,
          tags: content.tags,
        });
        resultEl.textContent = `저장되었습니다: ${saveResult.savedDir}`;
        resultEl.className = 'test-result success';
      } else {
        const publishResult = await window.api.naverPublish({
          keyword: content.keyword,
          workDir: content.workDir,
          title,
          body,
          tags: content.tags,
          images: content.images,
        });
        resultEl.textContent = normalizeErrorMessage(publishResult.message);
        resultEl.className = `test-result ${publishResult.success ? 'success' : 'error'}`;
      }
    } catch (err) {
      resultEl.textContent = normalizeErrorMessage(err, '처리 중 오류가 발생했습니다.');
      resultEl.className = 'test-result error';
    } finally {
      actionButton.disabled = false;
    }
  });
}
