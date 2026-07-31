// 패키징된(서명되지 않은) Electron 앱에서 네이티브 <select> 팝업이 실제 마우스 클릭을
// 받지 못하는 환경이 있어(설치 후 실사용 중 확인됨), 네이티브 select 대신 순수 DOM으로
// 직접 만든 드롭다운을 사용한다.
function escapeHtml(value) {
  // 설정값을 화면 HTML 안에 넣을 때 태그처럼 실행되지 않도록 문자로 바꾼다.
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function customSelectHtml(className, options, selectedValue, extraAttrs = '') {
  // 브라우저 기본 선택 상자 대신 사용할 드롭다운의 HTML을 만든다.
  // 실제 선택값은 data-value에 보관하고, 화면에는 사람이 읽는 label을 보여 준다.
  const selectedOption = options.find((o) => o.value === selectedValue) || options[0];
  const items = options
    .map(
      (o) => `<div class="custom-select-item${o.value === selectedValue ? ' selected' : ''}" data-value="${escapeAttr(o.value)}" role="option" aria-selected="${o.value === selectedValue}" tabindex="-1">${escapeHtml(o.label)}</div>`
    )
    .join('');
  return `
    <div class="custom-select ${escapeAttr(className)}" data-value="${escapeAttr(selectedOption.value)}" tabindex="0" role="combobox" aria-haspopup="listbox" aria-expanded="false" ${extraAttrs}>
      <div class="custom-select-trigger">${escapeHtml(selectedOption.label)}</div>
      <div class="custom-select-menu" role="listbox" hidden>${items}</div>
    </div>
  `;
}

function wireCustomSelects(container) {
  // 직접 만든 드롭다운도 마우스뿐 아니라 Enter·방향키·Escape로 사용할 수 있게 연결한다.
  container.querySelectorAll('.custom-select').forEach((select) => {
    if (select.dataset.wired) {
      return;
    }
    select.dataset.wired = 'true';

    const trigger = select.querySelector('.custom-select-trigger');
    const menu = select.querySelector('.custom-select-menu');
    const items = Array.from(menu.querySelectorAll('.custom-select-item'));
    const setOpen = (open) => {
      menu.hidden = !open;
      select.setAttribute('aria-expanded', String(open));
    };

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const wasHidden = menu.hidden;
      document.querySelectorAll('.custom-select-menu').forEach((m) => {
        m.hidden = true;
        m.closest('.custom-select')?.setAttribute('aria-expanded', 'false');
      });
      setOpen(wasHidden);
    });

    items.forEach((item) => {
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        select.dataset.value = item.dataset.value;
        trigger.textContent = item.textContent;
        items.forEach((i) => {
          i.classList.remove('selected');
          i.setAttribute('aria-selected', 'false');
        });
        item.classList.add('selected');
        item.setAttribute('aria-selected', 'true');
        setOpen(false);
        select.focus();
      });
    });

    select.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        select.focus();
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const focusedItem = document.activeElement?.closest?.('.custom-select-item');
        if (focusedItem && menu.contains(focusedItem)) {
          focusedItem.click();
        } else {
          setOpen(menu.hidden);
        }
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setOpen(true);
        const currentIndex = items.indexOf(document.activeElement);
        const nextIndex =
          event.key === 'ArrowDown'
            ? Math.min(items.length - 1, currentIndex + 1)
            : currentIndex <= 0
              ? items.length - 1
              : currentIndex - 1;
        items[nextIndex]?.focus();
      }
    });
  });
}

function setCustomSelectValue(select, value) {
  // 연결 테스트가 성공한 공급자를 즉시 활성 선택으로 보여 준다.
  const item = select?.querySelector(`.custom-select-item[data-value="${value}"]`);
  if (!select || !item) return;
  select.dataset.value = value;
  select.querySelector('.custom-select-trigger').textContent = item.textContent;
  select.querySelectorAll('.custom-select-item').forEach((candidate) => {
    const selected = candidate === item;
    candidate.classList.toggle('selected', selected);
    candidate.setAttribute('aria-selected', String(selected));
  });
}

if (!window.__customSelectGlobalClickWired) {
  // 드롭다운 바깥을 클릭하면 열린 목록을 닫는다. 한 번만 등록해 중복 이벤트를 막는다.
  window.__customSelectGlobalClickWired = true;
  document.addEventListener('click', () => {
    document.querySelectorAll('.custom-select-menu').forEach((m) => {
      m.hidden = true;
      m.closest('.custom-select')?.setAttribute('aria-expanded', 'false');
    });
  });
}

function providerCardHtml(kind, provider, savedModel, apiKeyInfo) {
  // AI 공급자 하나의 API 키·모델·연결 테스트 입력 영역을 만든다.
  // API 키는 실제 값 대신 저장 여부와 마스킹된 일부만 보인다.
  const hasKeyNote = apiKeyInfo.hasKey
    ? `저장된 키: ${apiKeyInfo.masked}`
    : '저장된 키 없음';
  return `
    <div class="provider-card" data-kind="${escapeAttr(kind)}" data-provider="${escapeAttr(provider.id)}">
      <h3>${escapeHtml(provider.label)}</h3>
      <div class="field-row">
        <label>API 키</label>
        <input type="password" class="input-api-key" placeholder="새 키를 입력하면 교체됩니다" autocomplete="off" />
        <button type="button" class="btn-open-api-key-page secondary" title="${escapeAttr(provider.label)} API 키 발급 페이지를 기본 브라우저로 엽니다">키 발급 페이지</button>
      </div>
      <div class="hint api-key-note">${escapeHtml(hasKeyNote)}</div>
      <div class="field-row">
        <label>모델명</label>
        <input type="text" class="input-model" value="${escapeAttr(savedModel || provider.defaultModel)}" />
      </div>
      <div class="field-row">
        <label></label>
        <button type="button" class="btn-test secondary">연결 테스트</button>
        <span class="test-result"></span>
      </div>
    </div>
  `;
}

function renderProviderSection(kind, providers, state) {
  const kindData = state.settings[kind];
  const options = providers.map((p) => ({ value: p.id, label: p.label }));

  const cards = providers
    .map((p) => providerCardHtml(kind, p, kindData.models[p.id], kindData.apiKeys[p.id]))
    .join('');

  return `
    <div class="field-row">
      <label>사용할 프로바이더</label>
      ${customSelectHtml('input-active-provider', options, kindData.provider, `data-kind="${kind}"`)}
    </div>
    ${cards}
  `;
}

function collectApiKeyPatch(container, kind, providers) {
  // 비밀번호 입력칸은 비어 있으면 기존 키를 유지하고, 새로 적은 경우에만 교체한다.
  const apiKeys = {};
  const models = {};
  providers.forEach((p) => {
    const card = container.querySelector(`.provider-card[data-kind="${kind}"][data-provider="${p.id}"]`);
    const typedKey = card.querySelector('.input-api-key').value.trim();
    if (typedKey) {
      apiKeys[p.id] = typedKey;
    }
    models[p.id] = card.querySelector('.input-model').value.trim() || p.defaultModel;
  });
  return { apiKeys, models };
}

function toBoundedNumber(value, minimum, maximum, fallback) {
  // 설정값이 비어 있거나 너무 작게 입력되면 안전한 기본값으로 보정한다.
  // 특히 완전자동 발행 간격은 계정 보호를 위해 30분보다 짧게 저장하지 않는다.
  const parsed = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : fallback));
}

function attachTestListeners(container) {
  // 각 공급자의 "연결 테스트" 버튼은 화면에 입력한 값 또는 저장된 값을 실제 API로 확인한다.
  container.querySelectorAll('.btn-test').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.provider-card');
      const kind = card.dataset.kind;
      const providerId = card.dataset.provider;
      const apiKey = card.querySelector('.input-api-key').value.trim();
      const model = card.querySelector('.input-model').value.trim();
      const resultEl = card.querySelector('.test-result');

      btn.disabled = true;
      resultEl.textContent = '테스트 중...';
      resultEl.className = 'test-result';

      try {
        const result = await window.api.testConnection({ kind, provider: providerId, apiKey, model });
        if (result.success) {
          // 성공한 키와 모델은 별도의 저장 버튼을 다시 누르지 않아도 암호화 저장한다.
          const providerPatch = { provider: providerId, models: { [providerId]: model } };
          if (apiKey) providerPatch.apiKeys = { [providerId]: apiKey };
          const response = await window.api.saveSettings({ [kind]: providerPatch });
          const keyInfo = response.settings[kind].apiKeys[providerId];
          card.querySelector('.input-api-key').value = '';
          card.querySelector('.api-key-note').textContent = keyInfo.hasKey
            ? `저장된 키: ${keyInfo.masked}`
            : '저장된 키 없음';
          setCustomSelectValue(
            container.querySelector(`.input-active-provider[data-kind="${kind}"]`),
            providerId
          );
        }
        resultEl.textContent = result.success ? `${result.message} 이 공급자로 저장했습니다.` : result.message;
        resultEl.className = `test-result ${result.success ? 'success' : 'error'}`;
      } catch (err) {
        resultEl.textContent = err.message || '연결 테스트에 실패했습니다.';
        resultEl.className = 'test-result error';
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function attachApiKeyPageListeners(container) {
  // 공급자 카드의 버튼을 누르면 키 원문과 무관하게 공식 발급 페이지를 기본 브라우저로 연다.
  container.querySelectorAll('.btn-open-api-key-page').forEach((button) => {
    button.addEventListener('click', async () => {
      const card = button.closest('.provider-card');
      const resultEl = card.querySelector('.test-result');
      button.disabled = true;
      try {
        await window.api.openApiKeyPage(card.dataset.provider);
      } catch (error) {
        resultEl.textContent = error.message || 'API 키 발급 페이지를 열지 못했습니다.';
        resultEl.className = 'test-result error';
      } finally {
        button.disabled = false;
      }
    });
  });
}

export async function initSettingsView(container) {
  // 설정 탭을 처음 열 때 저장된 설정과 선택 가능한 AI 목록을 함께 불러온다.
  container.innerHTML = `<p class="placeholder">설정을 불러오는 중...</p>`;

  const state = await window.api.getSettings();

  container.innerHTML = `
    <div class="settings-section">
      <h2>텍스트 AI</h2>
      <div id="text-provider-section"></div>
    </div>

    <div class="settings-section">
      <h2>이미지 AI</h2>
      <div id="image-provider-section"></div>
    </div>

    <div class="settings-section">
      <h2>네이버</h2>
      <div class="field-row">
        <label>블로그 ID</label>
        <input type="text" id="input-naver-blog-id" value="${escapeAttr(state.settings.naver.blogId)}" />
      </div>
      <div class="field-row">
        <label>로그인 상태</label>
        <span>${state.settings.naver.loggedIn ? '연결됨' : '연결 안 됨'}</span>
      </div>
      <div class="field-row">
        <label></label>
        <button type="button" id="btn-naver-login" class="secondary">네이버 로그인</button>
        <button type="button" id="btn-naver-reset" class="secondary">세션 초기화</button>
        <span class="test-result" id="naver-result"></span>
      </div>
    </div>

    <div class="settings-section">
      <h2>발행 기본값</h2>
      <div class="field-row">
        <label>카테고리명</label>
        <input type="text" id="input-category" value="${escapeAttr(state.settings.publishDefaults.category)}" />
      </div>
      <div class="field-row">
        <label>공개 설정</label>
        ${customSelectHtml(
          'input-visibility',
          [
            { value: 'public', label: '공개' },
            { value: 'private', label: '비공개' },
          ],
          state.settings.publishDefaults.visibility
        )}
      </div>
      <div class="field-row">
        <label>자동·예약 발행 간격(분)</label>
        <input type="number" id="input-interval" min="30" max="1440" value="${state.settings.publishDefaults.autoIntervalMinutes}" />
      </div>
      <div class="hint">최소 30분 미만으로는 설정할 수 없습니다.</div>
      <div class="field-row">
        <label>이미지 최대 개수</label>
        <input type="number" id="input-max-images" min="2" max="4" value="${state.settings.publishDefaults.maxImages}" />
      </div>
      <div class="hint">본문 품질과 가독성을 위해 2~4장으로 제한됩니다.</div>
      <div class="checkbox-row">
        <input type="checkbox" id="input-disclaimer" ${state.settings.publishDefaults.insertDisclaimer ? 'checked' : ''} />
        <label for="input-disclaimer">글 하단에 건강 정보 고지문 자동 삽입</label>
      </div>
    </div>

    <div class="settings-section">
      <h2>출력 폴더</h2>
      <div class="field-row">
        <label>반자동 저장 위치</label>
        <input type="text" id="input-output-folder" value="${escapeAttr(state.settings.outputFolder)}" readonly />
        <button type="button" id="btn-choose-folder" class="secondary">폴더 선택</button>
      </div>
    </div>

    <div class="save-bar">
      <span class="save-status" id="save-status"></span>
      <button type="button" id="btn-save-settings">설정 저장</button>
    </div>
  `;

  const textSection = container.querySelector('#text-provider-section');
  const imageSection = container.querySelector('#image-provider-section');
  textSection.innerHTML = renderProviderSection('text', state.textProviders, state);
  imageSection.innerHTML = renderProviderSection('image', state.imageProviders, state);
  attachTestListeners(container);
  attachApiKeyPageListeners(container);
  wireCustomSelects(container);

  container.querySelector('#btn-naver-login').addEventListener('click', async () => {
    const resultEl = container.querySelector('#naver-result');
    resultEl.textContent = '처리 중...';
    resultEl.className = 'test-result';
    const result = await window.api.naverLogin();
    resultEl.textContent = result.message;
    resultEl.className = `test-result ${result.success ? 'success' : 'error'}`;
  });

  container.querySelector('#btn-naver-reset').addEventListener('click', async () => {
    const resultEl = container.querySelector('#naver-result');
    resultEl.textContent = '처리 중...';
    resultEl.className = 'test-result';
    const result = await window.api.naverResetSession();
    resultEl.textContent = result.message;
    resultEl.className = `test-result ${result.success ? 'success' : 'error'}`;
  });

  container.querySelector('#btn-choose-folder').addEventListener('click', async () => {
    const chosen = await window.api.chooseOutputFolder();
    if (chosen) {
      container.querySelector('#input-output-folder').value = chosen;
    }
  });

  container.querySelector('#btn-save-settings').addEventListener('click', async () => {
    // 설정 저장 버튼을 누르면 화면의 모든 설정을 모아 암호화 저장소에 저장한다.
    // API 키는 새로 입력한 경우에만 교체하고, 저장 후에는 화면에 원문을 남기지 않는다.
    const saveStatus = container.querySelector('#save-status');
    saveStatus.textContent = '저장 중...';

    const textPatch = collectApiKeyPatch(container, 'text', state.textProviders);
    const imagePatch = collectApiKeyPatch(container, 'image', state.imageProviders);
    // 사용자가 5분처럼 짧은 값을 입력해도 실제 저장은 최소 30분으로 맞춘다.
    const autoIntervalMinutes = toBoundedNumber(container.querySelector('#input-interval').value, 30, 1440, 60);
    const maxImages = toBoundedNumber(container.querySelector('#input-max-images').value, 2, 4, 3);

    const patch = {
      text: {
        provider: container.querySelector('.input-active-provider[data-kind="text"]').dataset.value,
        apiKeys: textPatch.apiKeys,
        models: textPatch.models,
      },
      image: {
        provider: container.querySelector('.input-active-provider[data-kind="image"]').dataset.value,
        apiKeys: imagePatch.apiKeys,
        models: imagePatch.models,
      },
      naver: {
        blogId: container.querySelector('#input-naver-blog-id').value.trim(),
      },
      publishDefaults: {
        category: container.querySelector('#input-category').value.trim(),
        visibility: container.querySelector('.input-visibility').dataset.value,
        autoIntervalMinutes,
        maxImages,
        insertDisclaimer: container.querySelector('#input-disclaimer').checked,
      },
      outputFolder: container.querySelector('#input-output-folder').value,
    };

    try {
      const response = await window.api.saveSettings(patch);
      Object.assign(state, response);
      // 새로 입력한 키 값은 화면에 남기지 않고 마스킹 표시로 갱신한다.
      textSection.innerHTML = renderProviderSection('text', state.textProviders, state);
      imageSection.innerHTML = renderProviderSection('image', state.imageProviders, state);
      attachTestListeners(container);
      attachApiKeyPageListeners(container);
      wireCustomSelects(container);
      container.querySelector('#input-interval').value = state.settings.publishDefaults.autoIntervalMinutes;
      container.querySelector('#input-max-images').value = state.settings.publishDefaults.maxImages;
      saveStatus.textContent = '저장되었습니다.';
    } catch (err) {
      saveStatus.textContent = err.message || '저장에 실패했습니다.';
    } finally {
      setTimeout(() => {
        saveStatus.textContent = '';
      }, 3000);
    }
  });
}
