/**
 * 블로그의 공통 설정 화면을 데스크톱 앱 디자인에 맞게 정리한다.
 * AI 공급자, 계정, 출력 폴더를 구역별로 나누되 저장 동작은 기존 API를 그대로 사용한다.
 */
import { initSettingsView as initBaseSettingsView } from '../../blog/views/settings.js';

function getSettingsSectionCopy(includeInstagram) {
  return {
    text: {
      titleId: 'creator-settings-text-title',
      descriptionId: 'creator-settings-text-description',
      description: includeInstagram
        ? '블로그, 인스타그램, 유튜브의 문구와 대본 생성에 사용할 AI 서비스를 관리합니다.'
        : '네이버 블로그 제목과 본문 생성에 사용할 AI 서비스를 관리합니다.',
      warning: '연결 테스트를 실행하면 선택한 텍스트 AI 서비스에 실제 요청이 전송될 수 있습니다.',
    },
    image: {
      titleId: 'creator-settings-image-title',
      descriptionId: 'creator-settings-image-description',
      description: includeInstagram
        ? '블로그 이미지와 인스타그램 카드, 유튜브 장면 제작에 사용할 AI 서비스를 관리합니다.'
        : '네이버 블로그 본문 이미지 제작에 사용할 AI 서비스를 관리합니다.',
      warning: '연결 테스트를 실행하면 선택한 이미지 AI 서비스에 실제 요청이 전송될 수 있습니다.',
    },
  };
}

function ensureSectionDescription(section, { titleId, descriptionId, description }) {
  const title = section.querySelector(':scope > h2');
  if (!title) return null;

  title.id = titleId;
  section.setAttribute('aria-labelledby', titleId);

  let descriptionElement = section.querySelector(`:scope > #${descriptionId}`);
  if (!descriptionElement) {
    descriptionElement = document.createElement('p');
    descriptionElement.id = descriptionId;
    descriptionElement.className = 'creator-settings-section-description';
    title.insertAdjacentElement('afterend', descriptionElement);
  }
  descriptionElement.textContent = description;
  return descriptionElement;
}

function connectLabel(label, control, labelId) {
  if (!label || !control) return;
  if (control.id) {
    label.htmlFor = control.id;
  } else {
    label.id = labelId;
    control.setAttribute('aria-labelledby', labelId);
  }
}

function decorateProviderGroup(container, kind, sectionCopy) {
  const providerSection = container.querySelector(`#${kind}-provider-section`);
  const section = providerSection?.closest('.settings-section');
  const copy = sectionCopy[kind];
  if (!providerSection || !section || !copy) return;

  section.classList.add(
    'creator-settings-card',
    'creator-settings-ai-card',
    `creator-settings-${kind}-ai`
  );
  ensureSectionDescription(section, copy);

  const providerSelect = providerSection.querySelector(`.input-active-provider[data-kind="${kind}"]`);
  const providerSelectRow = providerSelect?.closest('.field-row');
  providerSelectRow?.classList.add('creator-settings-provider-select-row');
  connectLabel(
    providerSelectRow?.querySelector('label'),
    providerSelect,
    `creator-settings-${kind}-provider-label`
  );

  let warning = providerSection.querySelector(':scope > .creator-settings-api-warning');
  if (!warning) {
    warning = document.createElement('p');
    warning.className = 'creator-settings-api-warning';
    warning.id = `creator-settings-${kind}-api-warning`;
    warning.textContent = copy.warning;
    providerSelectRow?.insertAdjacentElement('afterend', warning);
  }

  providerSection.querySelectorAll('.provider-card').forEach((card) => {
    const providerId = card.dataset.provider;
    const heading = card.querySelector('h3');
    const rows = card.querySelectorAll('.field-row');
    const keyInput = card.querySelector('.input-api-key');
    const modelInput = card.querySelector('.input-model');
    const keyNote = card.querySelector('.api-key-note');
    const testButton = card.querySelector('.btn-test');
    const keyPageButton = card.querySelector('.btn-open-api-key-page');
    const result = card.querySelector('.test-result');

    card.classList.add('creator-settings-provider-card');
    heading.id = `creator-settings-${kind}-${providerId}-title`;
    card.setAttribute('aria-labelledby', heading.id);

    let activeBadge = heading.querySelector('.creator-provider-active-badge');
    if (!activeBadge) {
      activeBadge = document.createElement('span');
      activeBadge.className = 'creator-provider-active-badge';
      activeBadge.textContent = '현재 선택';
      heading.appendChild(activeBadge);
    }

    rows[0]?.classList.add('creator-provider-key-row');
    rows[1]?.classList.add('creator-provider-model-row');
    rows[2]?.classList.add('creator-provider-test-row');

    keyInput.id = `creator-settings-${kind}-${providerId}-api-key`;
    modelInput.id = `creator-settings-${kind}-${providerId}-model`;
    keyNote.id = `creator-settings-${kind}-${providerId}-key-status`;
    connectLabel(rows[0]?.querySelector('label'), keyInput);
    connectLabel(rows[1]?.querySelector('label'), modelInput);

    keyInput.setAttribute(
      'aria-describedby',
      `${keyNote.id} creator-settings-${kind}-api-warning`
    );
    const keyIsSaved = !keyNote.textContent.includes('없음');
    keyNote.classList.add('creator-settings-key-status');
    keyNote.classList.toggle('is-empty', !keyIsSaved);
    keyNote.classList.toggle('is-saved', keyIsSaved);
    testButton?.setAttribute('aria-describedby', `creator-settings-${kind}-api-warning`);
    keyPageButton?.setAttribute('aria-describedby', `creator-settings-${kind}-api-warning`);
    result?.setAttribute('aria-live', 'polite');
  });

  const syncActiveProvider = () => {
    const activeProviderId = providerSelect?.dataset.value;
    providerSection.querySelectorAll('.provider-card').forEach((card) => {
      const active = card.dataset.provider === activeProviderId;
      card.classList.toggle('is-active-provider', active);
      const badge = card.querySelector('.creator-provider-active-badge');
      if (badge) badge.hidden = !active;
    });
  };

  syncActiveProvider();
}

function decorateNaverSection(container) {
  const input = container.querySelector('#input-naver-blog-id');
  const section = input?.closest('.settings-section');
  if (!input || !section) return;

  section.classList.add(
    'creator-settings-card',
    'creator-settings-account-card',
    'creator-settings-naver'
  );
  const description = ensureSectionDescription(section, {
    titleId: 'creator-settings-naver-title',
    descriptionId: 'creator-settings-naver-description',
    description: '네이버 블로그 ID와 로그인 세션 상태를 관리합니다.',
  });
  section.querySelector(':scope > h2').textContent = '네이버 계정';

  const rows = section.querySelectorAll('.field-row');
  rows[0]?.classList.add('creator-settings-account-field');
  rows[1]?.classList.add('creator-settings-account-status-row');
  rows[2]?.classList.add('creator-settings-account-actions');
  connectLabel(rows[0]?.querySelector('label'), input);

  const status = rows[1]?.querySelector('span');
  if (status) {
    status.id = 'creator-naver-status';
    status.classList.add('creator-account-status');
    status.classList.toggle('success', status.textContent.trim() === '연결됨');
    status.setAttribute('aria-live', 'polite');
  }

  const loginButton = section.querySelector('#btn-naver-login');
  const resetButton = section.querySelector('#btn-naver-reset');
  const result = section.querySelector('#naver-result');
  loginButton?.classList.add('creator-account-login');
  resetButton?.classList.add('creator-danger-action');
  result?.setAttribute('aria-live', 'polite');

  let resetNote = section.querySelector('#creator-settings-naver-reset-note');
  if (!resetNote) {
    resetNote = document.createElement('p');
    resetNote.id = 'creator-settings-naver-reset-note';
    resetNote.className = 'creator-settings-reset-note';
    resetNote.textContent = '세션 초기화 후에는 네이버에 다시 로그인해야 할 수 있습니다.';
    rows[2]?.insertAdjacentElement('afterend', resetNote);
  }
  loginButton?.setAttribute('aria-describedby', description.id);
  resetButton?.setAttribute('aria-describedby', resetNote.id);
}

function decoratePublishDefaults(container) {
  const categoryInput = container.querySelector('#input-category');
  const section = categoryInput?.closest('.settings-section');
  if (!categoryInput || !section) return;

  section.classList.add(
    'creator-settings-card',
    'creator-settings-defaults'
  );
  ensureSectionDescription(section, {
    titleId: 'creator-settings-defaults-title',
    descriptionId: 'creator-settings-defaults-description',
    description: '블로그 콘텐츠를 저장하거나 발행할 때 사용할 기본값입니다.',
  });

  const visibility = section.querySelector('.input-visibility');
  const interval = section.querySelector('#input-interval');
  const maxImages = section.querySelector('#input-max-images');
  const rows = section.querySelectorAll('.field-row');
  rows.forEach((row) => row.classList.add('creator-settings-default-field'));
  connectLabel(rows[0]?.querySelector('label'), categoryInput);
  connectLabel(rows[1]?.querySelector('label'), visibility, 'creator-settings-visibility-label');
  connectLabel(rows[2]?.querySelector('label'), interval);
  connectLabel(rows[3]?.querySelector('label'), maxImages);

  const intervalHint = rows[2]?.nextElementSibling;
  const imageHint = rows[3]?.nextElementSibling;
  if (intervalHint?.classList.contains('hint')) {
    intervalHint.id = 'creator-settings-interval-help';
    interval.setAttribute('aria-describedby', intervalHint.id);
  }
  if (imageHint?.classList.contains('hint')) {
    imageHint.id = 'creator-settings-image-count-help';
    maxImages.setAttribute('aria-describedby', imageHint.id);
  }
}

function decorateOutputSection(container) {
  const outputInput = container.querySelector('#input-output-folder');
  const section = outputInput?.closest('.settings-section');
  if (!outputInput || !section) return;

  section.classList.add(
    'creator-settings-card',
    'creator-settings-output'
  );
  ensureSectionDescription(section, {
    titleId: 'creator-settings-output-title',
    descriptionId: 'creator-settings-output-description',
    description: '반자동으로 만든 콘텐츠와 플랫폼별 결과물이 저장되는 위치입니다.',
  });

  const row = outputInput.closest('.field-row');
  row?.classList.add('creator-settings-output-row');
  connectLabel(row?.querySelector('label'), outputInput);

  let help = section.querySelector('#creator-settings-output-help');
  if (!help) {
    help = document.createElement('p');
    help.id = 'creator-settings-output-help';
    help.className = 'creator-settings-output-help';
    help.textContent = '폴더 선택은 운영체제의 폴더 선택 창을 엽니다.';
    row?.insertAdjacentElement('afterend', help);
  }
  outputInput.setAttribute('aria-describedby', help.id);
  section.querySelector('#btn-choose-folder')?.setAttribute('aria-describedby', help.id);
}

function decorateSaveArea(container) {
  const saveBar = container.querySelector('.save-bar');
  const saveButton = saveBar?.querySelector('#btn-save-settings');
  const saveStatus = saveBar?.querySelector('#save-status');
  if (!saveBar || !saveButton || !saveStatus) return;

  saveBar.classList.add('creator-settings-save');
  let copy = saveBar.querySelector('.creator-settings-save-copy');
  if (!copy) {
    copy = document.createElement('div');
    copy.className = 'creator-settings-save-copy';
    copy.id = 'creator-settings-save-help';
    copy.innerHTML = `
      <strong>설정 저장</strong>
      <p>API Key, 발행 기본값과 출력 폴더 변경사항을 확인한 후 저장하세요.</p>
    `;
    saveBar.prepend(copy);
  }
  saveStatus.setAttribute('aria-live', 'polite');
  saveButton.setAttribute('aria-describedby', copy.id);
}

function buildSettingsWorkspace(container, { includeInstagram }) {
  if (container.querySelector('.creator-settings-workspace')) return;

  const groups = [
    {
      id: 'text',
      label: '텍스트 AI',
      description: '문구와 대본 생성',
      sections: [container.querySelector('.creator-settings-text-ai')],
    },
    {
      id: 'image',
      label: '이미지 AI',
      description: '이미지와 장면 생성',
      sections: [container.querySelector('.creator-settings-image-ai')],
    },
    {
      id: 'accounts',
      label: '채널 계정',
      description: includeInstagram ? '네이버와 인스타그램' : '네이버 블로그',
      sections: [
        container.querySelector('.creator-settings-naver'),
        includeInstagram ? container.querySelector('.creator-settings-instagram') : null,
      ],
    },
    {
      id: 'publish',
      label: '발행 기본값',
      description: '공개 범위와 자동 간격',
      sections: [container.querySelector('.creator-settings-defaults')],
    },
    {
      id: 'output',
      label: '출력 폴더',
      description: '결과 저장 위치',
      sections: [container.querySelector('.creator-settings-output')],
    },
  ];

  const workspace = document.createElement('div');
  workspace.className = 'creator-settings-workspace';

  const navigation = document.createElement('nav');
  navigation.className = 'creator-settings-local-nav';
  navigation.setAttribute('aria-label', '설정 항목');
  navigation.innerHTML = groups
    .map(
      (group, index) => `
        <button
          type="button"
          data-settings-target="${group.id}"
          aria-pressed="${index === 0}"
          class="${index === 0 ? 'active' : ''}"
        >
          <strong>${group.label}</strong>
          <span>${group.description}</span>
        </button>
      `
    )
    .join('');

  const content = document.createElement('div');
  content.className = 'creator-settings-content';
  groups.forEach((group) => {
    group.sections.filter(Boolean).forEach((section) => {
      section.dataset.settingsGroup = group.id;
      content.appendChild(section);
    });
  });

  const saveBar = container.querySelector('.creator-settings-save');
  if (saveBar) content.appendChild(saveBar);
  workspace.append(navigation, content);
  container.appendChild(workspace);

  const showGroup = (groupId) => {
    groups.forEach((group) => {
      const active = group.id === groupId;
      group.sections.filter(Boolean).forEach((section) => {
        section.hidden = !active;
      });
      const button = navigation.querySelector(`[data-settings-target="${group.id}"]`);
      button?.classList.toggle('active', active);
      button?.setAttribute('aria-pressed', String(active));
    });
    content.scrollTop = 0;
  };

  navigation.querySelectorAll('[data-settings-target]').forEach((button) => {
    button.addEventListener('click', () => showGroup(button.dataset.settingsTarget));
  });
  showGroup('text');
}

function decorateSettingsView(container, { includeInstagram }) {
  const sectionCopy = getSettingsSectionCopy(includeInstagram);
  container.classList.add('creator-settings-view');
  decorateProviderGroup(container, 'text', sectionCopy);
  decorateProviderGroup(container, 'image', sectionCopy);
  decorateNaverSection(container);
  decoratePublishDefaults(container);
  decorateOutputSection(container);
  decorateSaveArea(container);

  for (const kind of ['text', 'image']) {
    const providerSection = container.querySelector(`#${kind}-provider-section`);
    if (!providerSection || providerSection.dataset.creatorSettingsObserved === 'true') continue;
    providerSection.dataset.creatorSettingsObserved = 'true';
    const observer = new MutationObserver(() => decorateProviderGroup(container, kind, sectionCopy));
    observer.observe(providerSection, {
      attributes: true,
      attributeFilter: ['data-value'],
      childList: true,
      subtree: true,
    });
  }
}

export async function initStyledSettingsView(container, { includeInstagram = false } = {}) {
  await initBaseSettingsView(container);

  let instagramSection = null;
  if (includeInstagram) {
    instagramSection = document.createElement('div');
    instagramSection.className =
      'settings-section creator-settings-card creator-settings-account-card creator-settings-instagram';
    instagramSection.setAttribute('aria-labelledby', 'creator-settings-instagram-title');
    instagramSection.innerHTML = `
      <h2 id="creator-settings-instagram-title">인스타그램 계정</h2>
      <p id="creator-settings-instagram-description" class="creator-settings-section-description">
        인스타그램 카드 발행에 사용할 로그인 세션 상태를 관리합니다.
      </p>
      <div class="creator-settings-account-status-row">
        <span class="creator-settings-account-label">로그인 상태</span>
        <span id="creator-instagram-status" aria-live="polite">확인 중...</span>
      </div>
      <div class="creator-settings-account-actions">
        <button type="button" id="creator-instagram-login" class="secondary creator-account-login" aria-describedby="creator-settings-instagram-description">인스타그램 로그인</button>
        <button type="button" id="creator-instagram-reset" class="secondary creator-danger-action" aria-describedby="creator-settings-instagram-reset-note">세션 초기화</button>
        <span id="creator-instagram-result" class="test-result" aria-live="polite"></span>
      </div>
      <p id="creator-settings-instagram-reset-note" class="creator-settings-reset-note">
        세션 초기화 후에는 인스타그램에 다시 로그인해야 할 수 있습니다.
      </p>
    `;

    const saveBar = container.querySelector('.save-bar');
    const publishDefaultsSection = container.querySelector('#input-category')?.closest('.settings-section');
    container.insertBefore(instagramSection, publishDefaultsSection || saveBar || null);
  }

  decorateSettingsView(container, { includeInstagram });
  buildSettingsWorkspace(container, { includeInstagram });
  if (!instagramSection) return;

  const statusEl = instagramSection.querySelector('#creator-instagram-status');
  const resultEl = instagramSection.querySelector('#creator-instagram-result');
  const loginButton = instagramSection.querySelector('#creator-instagram-login');
  const resetButton = instagramSection.querySelector('#creator-instagram-reset');

  const refreshStatus = async () => {
    const status = await window.api.instagramSessionStatus();
    statusEl.textContent = status.loggedIn
      ? status.username
        ? `연결됨 (@${status.username})`
        : '연결됨'
      : '연결 안 됨';
    statusEl.className = `test-result ${status.loggedIn ? 'success' : ''}`;
  };

  await refreshStatus();

  loginButton.addEventListener('click', async () => {
    loginButton.disabled = true;
    resultEl.textContent = '열린 Chromium 창에서 로그인해 주세요.';
    resultEl.className = 'test-result';
    try {
      const result = await window.api.instagramLogin();
      resultEl.textContent = result.message;
      resultEl.className = `test-result ${result.success ? 'success' : 'error'}`;
      await refreshStatus();
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
      await refreshStatus();
    } finally {
      resetButton.disabled = false;
    }
  });
}
