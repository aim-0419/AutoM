const dashboardRenderVersions = new WeakMap();

const platformMeta = {
  blog: {
    label: '블로그',
    countLabel: '블로그 기록',
  },
  instagram: {
    label: '인스타그램',
    countLabel: '인스타그램 기록',
  },
  youtube: {
    label: '유튜브',
    countLabel: '유튜브 작업 기록',
  },
};

function getPlatform(entry) {
  const platform = String(entry?.platform || '').toLowerCase();
  if (platform === 'instagram') return 'instagram';
  if (platform === 'youtube') return 'youtube';
  return 'blog';
}

function parseRecordedAt(value) {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatSeoulTime(value) {
  const timestamp = parseRecordedAt(value);
  if (timestamp === null) return null;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(new Date(timestamp))
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDashboardClock(value = new Date()) {
  return {
    date: new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    })
      .format(value)
      .replace(/\s+/g, ' ')
      .trim(),
    time: new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(value),
  };
}

function getSeoulDateKey(value) {
  const timestamp = value instanceof Date ? value.getTime() : parseRecordedAt(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp));
}

function getRecentDateKeys(days = 7) {
  const keys = [];
  const now = Date.now();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    keys.push(getSeoulDateKey(new Date(now - offset * 24 * 60 * 60 * 1000)));
  }
  return keys;
}

function getRecordStatus(entry) {
  const platform = getPlatform(entry);
  if (entry?.status === 'success') {
    if (platform === 'youtube') {
      return { label: '생성 완료', tone: 'success' };
    }
    const scheduledAt = parseRecordedAt(entry?.scheduledAt);
    if (scheduledAt !== null && scheduledAt > Date.now()) {
      return { label: '예약', tone: 'scheduled' };
    }
    return { label: '성공', tone: 'success' };
  }
  if (entry?.status === 'failure') {
    return {
      label: platform === 'youtube' ? '생성 실패' : '실패',
      tone: 'error',
    };
  }
  return { label: '확인 불가', tone: 'neutral' };
}

function getProviderLabel(state, kind, providerId) {
  const providers = kind === 'text' ? state?.textProviders : state?.imageProviders;
  const provider = Array.isArray(providers)
    ? providers.find((candidate) => candidate.id === providerId)
    : null;
  return provider?.label || providerId || '설정 필요';
}

function getDashboardLoaders(overrides = {}) {
  return {
    settings:
      typeof overrides.settings === 'function'
        ? overrides.settings
        : typeof window.api?.getSettings === 'function'
          ? () => window.api.getSettings()
          : null,
    history:
      typeof overrides.history === 'function'
        ? overrides.history
        : typeof window.api?.historyList === 'function'
          ? () => window.api.historyList()
          : null,
    instagram:
      typeof overrides.instagram === 'function'
        ? overrides.instagram
        : typeof window.api?.instagramSessionStatus === 'function'
          ? () => window.api.instagramSessionStatus()
          : null,
  };
}

function runOptionalLoader(loader) {
  if (!loader) return Promise.resolve({ available: false, value: null });
  return Promise.resolve()
    .then(() => loader())
    .then((value) => ({ available: true, value }));
}

function setText(container, selector, value) {
  const element = container.querySelector(selector);
  if (element) element.textContent = value;
}

function setBadge(container, cardId, label, tone) {
  const badge = container.querySelector(`[data-dashboard-card="${cardId}"] [data-dashboard-badge]`);
  if (!badge) return;
  badge.textContent = label;
  badge.className = `creator-dashboard-state-badge is-${tone}`;
}

function setRecordSummaryState(container, recordId, label, tone = 'neutral') {
  const element = container.querySelector(
    `[data-dashboard-record="${recordId}"] [data-dashboard-record-recent]`
  );
  if (!element) return;
  element.textContent = label;
  element.className = `creator-dashboard-summary-status is-${tone}`;
}

function renderAiStatus(container, kind, settingsResult) {
  const cardId = kind === 'text' ? 'text-ai' : 'image-ai';
  if (settingsResult.status === 'rejected') {
    setBadge(container, cardId, '확인 불가', 'error');
    setText(container, `[data-dashboard-card="${cardId}"] [data-dashboard-provider]`, '불러오지 못함');
    setText(container, `[data-dashboard-card="${cardId}"] [data-dashboard-model]`, '불러오지 못함');
    setText(container, `[data-dashboard-card="${cardId}"] [data-dashboard-key]`, '확인 불가');
    return;
  }

  if (!settingsResult.value.available) {
    setBadge(container, cardId, '설정에서 확인', 'neutral');
    setText(container, `[data-dashboard-card="${cardId}"] [data-dashboard-provider]`, '설정 화면에서 확인');
    setText(container, `[data-dashboard-card="${cardId}"] [data-dashboard-model]`, '설정 화면에서 확인');
    setText(container, `[data-dashboard-card="${cardId}"] [data-dashboard-key]`, '확인 불가');
    return;
  }

  const state = settingsResult.value.value;
  const providerSettings = state?.settings?.[kind];
  const providerId = providerSettings?.provider;
  const model = providerSettings?.models?.[providerId];
  const hasKey = providerSettings?.apiKeys?.[providerId]?.hasKey === true;
  const configured = Boolean(providerId && model && hasKey);

  setBadge(container, cardId, configured ? '설정됨' : '설정 필요', configured ? 'success' : 'warning');
  setText(
    container,
    `[data-dashboard-card="${cardId}"] [data-dashboard-provider]`,
    getProviderLabel(state, kind, providerId)
  );
  setText(container, `[data-dashboard-card="${cardId}"] [data-dashboard-model]`, model || '설정 필요');
  setText(
    container,
    `[data-dashboard-card="${cardId}"] [data-dashboard-key]`,
    hasKey ? '설정됨' : '설정 필요'
  );
}

function renderNaverStatus(container, settingsResult) {
  if (settingsResult.status === 'rejected') {
    setBadge(container, 'naver', '확인 불가', 'error');
    setText(container, '[data-dashboard-card="naver"] [data-dashboard-account-status]', '불러오지 못함');
    return;
  }

  if (!settingsResult.value.available) {
    setBadge(container, 'naver', '설정에서 확인', 'neutral');
    setText(
      container,
      '[data-dashboard-card="naver"] [data-dashboard-account-status]',
      '설정 화면에서 확인'
    );
    return;
  }

  const loggedIn = settingsResult.value.value?.settings?.naver?.loggedIn === true;
  setBadge(container, 'naver', loggedIn ? '로그인됨' : '로그인 필요', loggedIn ? 'success' : 'warning');
  setText(
    container,
    '[data-dashboard-card="naver"] [data-dashboard-account-status]',
    loggedIn ? '로컬 로그인 상태 있음' : '로그인 상태 없음'
  );
}

function renderInstagramStatus(container, instagramResult) {
  if (instagramResult.status === 'rejected' || !instagramResult.value.available) {
    setBadge(container, 'instagram', '확인 불가', 'error');
    setText(
      container,
      '[data-dashboard-card="instagram"] [data-dashboard-account-status]',
      '설정에서 다시 확인'
    );
    setText(container, '[data-dashboard-greeting-name]', '사용자님!');
    const userName = document.getElementById('creator-sidebar-user-name');
    const userStatus = document.getElementById('creator-sidebar-user-status');
    if (userName) userName.textContent = 'AutoM 사용자';
    if (userStatus) userStatus.textContent = '로컬 작업 환경';
    return;
  }

  const loggedIn = instagramResult.value.value?.loggedIn === true;
  const username = String(instagramResult.value.value?.username || '').trim();
  setBadge(
    container,
    'instagram',
    loggedIn ? '로그인됨' : '로그인 필요',
    loggedIn ? 'success' : 'warning'
  );
  setText(
    container,
    '[data-dashboard-card="instagram"] [data-dashboard-account-status]',
    loggedIn ? '로컬 로그인 상태 있음' : '로그인 상태 없음'
  );
  setText(
    container,
    '[data-dashboard-greeting-name]',
    loggedIn && username ? `@${username}님!` : '사용자님!'
  );
  const userName = document.getElementById('creator-sidebar-user-name');
  const userStatus = document.getElementById('creator-sidebar-user-status');
  if (userName) userName.textContent = loggedIn && username ? `@${username}` : 'AutoM 사용자';
  if (userStatus) userStatus.textContent = loggedIn ? '인스타그램 연결됨' : '로컬 작업 환경';
}

function normalizeHistory(value) {
  if (!Array.isArray(value)) {
    throw new Error('기록 목록 형식이 올바르지 않습니다.');
  }
  return value.filter((entry) => entry && typeof entry === 'object');
}

function getSortedEntries(entries, platformId = null) {
  return entries
    .filter((entry) => !platformId || getPlatform(entry) === platformId)
    .map((entry) => ({ entry, timestamp: parseRecordedAt(entry.date) }))
    .filter((item) => item.timestamp !== null)
    .sort((left, right) => right.timestamp - left.timestamp);
}

function renderRecordTrend(container, recordId, entries, platformId = null) {
  const trend = container.querySelector(
    `[data-dashboard-record="${recordId}"] [data-dashboard-trend]`
  );
  if (!trend) return;

  const keys = getRecentDateKeys();
  const counts = keys.map((key) =>
    entries.filter(
      (entry) =>
        (!platformId || getPlatform(entry) === platformId) &&
        getSeoulDateKey(entry.date) === key
    ).length
  );
  const maxCount = Math.max(1, ...counts);
  trend.replaceChildren(
    ...counts.map((count, index) => {
      const bar = document.createElement('span');
      bar.style.height = `${Math.max(5, Math.round((count / maxCount) * 30))}px`;
      bar.title = `${keys[index]} 작업 ${count}건`;
      return bar;
    })
  );
}

function renderRecordSummary(container, historyResult) {
  if (historyResult.status === 'rejected' || !historyResult.value.available) {
    [...Object.keys(platformMeta), 'today'].forEach((platformId) => {
      setText(
        container,
        `[data-dashboard-record="${platformId}"] [data-dashboard-record-count]`,
        '-'
      );
      setRecordSummaryState(container, platformId, '확인 불가', 'error');
    });
    return null;
  }

  const entries = normalizeHistory(historyResult.value.value);
  Object.keys(platformMeta).forEach((platformId) => {
    const platformEntries = entries.filter((entry) => getPlatform(entry) === platformId);
    const sortedEntries = getSortedEntries(platformEntries);
    const latest = sortedEntries[0]?.entry;
    const latestStatus = latest ? getRecordStatus(latest) : null;

    setText(
      container,
      `[data-dashboard-record="${platformId}"] [data-dashboard-record-count]`,
      String(platformEntries.length)
    );
    setRecordSummaryState(
      container,
      platformId,
      latestStatus
        ? latestStatus.label
        : platformEntries.length > 0
          ? '시각 확인 불가'
          : '기록 없음',
      latestStatus?.tone || 'neutral'
    );
    renderRecordTrend(container, platformId, entries, platformId);
  });

  const todayKey = getSeoulDateKey(new Date());
  const todayEntries = entries.filter(
    (entry) =>
      getSeoulDateKey(entry.date) === todayKey &&
      getRecordStatus(entry).tone === 'success'
  );
  setText(
    container,
    '[data-dashboard-record="today"] [data-dashboard-record-count]',
    String(todayEntries.length)
  );
  setRecordSummaryState(
    container,
    'today',
    `오늘 ${todayEntries.length}건`,
    todayEntries.length > 0 ? 'success' : 'neutral'
  );
  renderRecordTrend(container, 'today', entries);
  return entries;
}

function createRecentItem(entry) {
  const platformId = getPlatform(entry);
  const status = getRecordStatus(entry);
  const item = document.createElement('li');
  item.className = 'creator-dashboard-activity-item';

  const platform = document.createElement('span');
  platform.className = `creator-dashboard-platform is-${platformId}`;
  platform.textContent = platformMeta[platformId].label;

  const content = document.createElement('div');
  content.className = 'creator-dashboard-activity-content';
  const title = document.createElement('strong');
  title.textContent = String(entry.title || entry.keyword || '제목 없음');
  const keyword = document.createElement('span');
  keyword.textContent = entry.keyword ? `키워드: ${String(entry.keyword)}` : '키워드 없음';
  content.append(title, keyword);

  const time = document.createElement('time');
  time.dateTime = entry.date;
  time.textContent = formatSeoulTime(entry.date) || '시각 확인 불가';

  const badge = document.createElement('span');
  badge.className = `creator-dashboard-state-badge is-${status.tone}`;
  badge.textContent = status.label;

  item.append(platform, content, time, badge);
  return item;
}

function renderRecentActivity(container, entries, historyAvailable) {
  const list = container.querySelector('#creator-dashboard-activity-list');
  const empty = container.querySelector('#creator-dashboard-activity-empty');
  if (!list || !empty) return;
  list.replaceChildren();

  if (!historyAvailable) {
    empty.hidden = false;
    empty.textContent = '최근 작업을 불러오지 못했습니다. 발행 기록 화면에서 다시 확인해 주세요.';
    return;
  }

  const recentEntries = getSortedEntries(entries)
    .slice(0, 5)
    .map((item) => item.entry);
  if (recentEntries.length === 0) {
    empty.hidden = false;
    empty.textContent =
      entries.length === 0
        ? '아직 표시할 작업 기록이 없습니다. 콘텐츠를 만들거나 발행하면 이곳에서 확인할 수 있습니다.'
        : '기록은 있지만 작업 시각을 확인할 수 없습니다. 발행 기록 화면에서 확인해 주세요.';
    return;
  }

  empty.hidden = true;
  recentEntries.forEach((entry) => list.appendChild(createRecentItem(entry)));
}

function addNotice(list, { title, description, target, tone = 'warning', action }) {
  const item = document.createElement('li');
  item.className = `creator-dashboard-notice is-${tone}`;

  const copy = document.createElement('div');
  const heading = document.createElement('strong');
  heading.textContent = title;
  const detail = document.createElement('span');
  detail.textContent = description;
  copy.append(heading, detail);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.dataset.dashboardTarget = target;
  button.textContent = action;
  button.setAttribute('aria-label', `${title}: ${action}`);

  item.append(copy, button);
  list.appendChild(item);
}

function renderNotices(container, settingsResult, instagramResult, historyAvailable) {
  const list = container.querySelector('#creator-dashboard-notice-list');
  if (!list) return;
  list.replaceChildren();

  if (settingsResult.status === 'fulfilled' && settingsResult.value.available) {
    const state = settingsResult.value.value;
    for (const [kind, label] of [
      ['text', '텍스트 AI'],
      ['image', '이미지 AI'],
    ]) {
      const providerId = state?.settings?.[kind]?.provider;
      const hasKey = state?.settings?.[kind]?.apiKeys?.[providerId]?.hasKey === true;
      if (!hasKey) {
        addNotice(list, {
          title: `${label} API Key 설정 필요`,
          description: '콘텐츠 생성 전에 사용할 Provider와 API Key를 확인하세요.',
          target: 'settings',
          action: `${label} 설정 열기`,
        });
      }
    }
    if (state?.settings?.naver?.loggedIn !== true) {
      addNotice(list, {
        title: '네이버 로그인 필요',
        description: '블로그 발행 전에 설정 화면에서 로그인 상태를 확인하세요.',
        target: 'settings',
        action: '네이버 설정 열기',
      });
    }
  } else {
    addNotice(list, {
      title: 'AI 및 네이버 설정 확인',
      description: 'Provider, API Key와 네이버 로그인 상태는 설정 화면에서 확인할 수 있습니다.',
      target: 'settings',
      tone: settingsResult.status === 'rejected' ? 'error' : 'neutral',
      action: '설정 열기',
    });
  }

  if (instagramResult.status !== 'fulfilled' || !instagramResult.value.available) {
    addNotice(list, {
      title: '인스타그램 상태 확인 불가',
      description: '설정 화면에서 로그인 상태를 다시 확인해 주세요.',
      target: 'settings',
      tone: 'error',
      action: '인스타그램 설정 열기',
    });
  } else if (instagramResult.value.value?.loggedIn !== true) {
    addNotice(list, {
      title: '인스타그램 로그인 필요',
      description: '인스타그램 발행 전에 설정 화면에서 로그인을 완료하세요.',
      target: 'settings',
      action: '인스타그램 설정 열기',
    });
  }

  if (!historyAvailable) {
    addNotice(list, {
      title: '로컬 기록 확인 불가',
      description: '일부 기록을 불러오지 못했습니다. 발행 기록 화면에서 다시 확인해 주세요.',
      target: 'history',
      tone: 'error',
      action: '발행 기록 보기',
    });
  }

  addNotice(list, {
    title: '유튜브는 외부 업로드 필요',
    description: 'AutoM은 영상 콘텐츠를 생성하며 YouTube에 직접 업로드하지 않습니다.',
    target: 'youtube',
    tone: 'neutral',
    action: '유튜브 콘텐츠 열기',
  });
}

function wireDashboardNavigation(container, navigate) {
  container.querySelectorAll('[data-dashboard-target]').forEach((button) => {
    if (button.dataset.dashboardWired === 'true') return;
    button.dataset.dashboardWired = 'true';
    button.addEventListener('click', () => {
      const target = button.dataset.dashboardTarget;
      if (typeof navigate === 'function' && platformTargetValues.has(target)) {
        navigate(target);
      }
    });
  });
}

const platformTargetValues = new Set(['blog', 'instagram', 'youtube', 'history', 'settings']);

function renderDashboardShell(container) {
  container.className = 'tab-panel active creator-dashboard-view';
  container.setAttribute('aria-busy', 'true');
  container.innerHTML = `
    <section class="creator-dashboard-intro" aria-labelledby="creator-dashboard-intro-title">
      <div>
        <span class="creator-dashboard-eyebrow">오늘의 작업</span>
        <h2 id="creator-dashboard-intro-title">
          안녕하세요, <span data-dashboard-greeting-name>사용자님!</span>
        </h2>
        <p>오늘도 AI와 함께 스마트한 마케팅 콘텐츠를 준비해 보세요.</p>
      </div>
      <div class="creator-dashboard-refresh" aria-label="현재 한국 날짜와 시간">
        <span id="creator-dashboard-current-date">날짜 확인 중</span>
        <strong id="creator-dashboard-current-time">--:--</strong>
      </div>
    </section>

    <p id="creator-dashboard-live" class="creator-dashboard-live" aria-live="polite">
      대시보드 상태를 불러오는 중입니다.
    </p>
    <div id="creator-dashboard-error" class="creator-dashboard-error" role="status" aria-live="polite" hidden>
      일부 상태를 불러오지 못했습니다. 설정 또는 발행 기록 화면에서 다시 확인해 주세요.
    </div>

    <section class="creator-dashboard-summary" aria-label="플랫폼별 작업 요약">
      <div class="creator-dashboard-record-grid">
        <article class="creator-dashboard-card creator-dashboard-record-card" data-dashboard-record="blog">
          <div class="creator-dashboard-summary-heading">
            <div>
              <span class="creator-dashboard-card-kicker is-blog">B</span>
              <h3>블로그</h3>
            </div>
            <span data-dashboard-record-recent>최근 상태 확인 중</span>
          </div>
          <div class="creator-dashboard-summary-body">
            <div>
              <strong data-dashboard-record-count>불러오는 중</strong>
              <span>${platformMeta.blog.countLabel}</span>
            </div>
            <div class="creator-dashboard-trend is-blog" data-dashboard-trend aria-label="최근 7일 블로그 작업 추이"></div>
          </div>
        </article>

        <article class="creator-dashboard-card creator-dashboard-record-card" data-dashboard-record="instagram">
          <div class="creator-dashboard-summary-heading">
            <div>
              <span class="creator-dashboard-card-kicker is-instagram">I</span>
              <h3>인스타그램</h3>
            </div>
            <span data-dashboard-record-recent>최근 상태 확인 중</span>
          </div>
          <div class="creator-dashboard-summary-body">
            <div>
              <strong data-dashboard-record-count>불러오는 중</strong>
              <span>${platformMeta.instagram.countLabel}</span>
            </div>
            <div class="creator-dashboard-trend is-instagram" data-dashboard-trend aria-label="최근 7일 인스타그램 작업 추이"></div>
          </div>
        </article>

        <article class="creator-dashboard-card creator-dashboard-record-card" data-dashboard-record="youtube">
          <div class="creator-dashboard-summary-heading">
            <div>
              <span class="creator-dashboard-card-kicker is-youtube">Y</span>
              <h3>유튜브</h3>
            </div>
            <span data-dashboard-record-recent>최근 상태 확인 중</span>
          </div>
          <div class="creator-dashboard-summary-body">
            <div>
              <strong data-dashboard-record-count>불러오는 중</strong>
              <span>${platformMeta.youtube.countLabel}</span>
            </div>
            <div class="creator-dashboard-trend is-youtube" data-dashboard-trend aria-label="최근 7일 유튜브 작업 추이"></div>
          </div>
        </article>

        <article class="creator-dashboard-card creator-dashboard-record-card" data-dashboard-record="today">
          <div class="creator-dashboard-summary-heading">
            <div>
              <span class="creator-dashboard-card-kicker is-today">✓</span>
              <h3>오늘 완료</h3>
            </div>
            <span data-dashboard-record-recent>오늘 기록 확인 중</span>
          </div>
          <div class="creator-dashboard-summary-body">
            <div>
              <strong data-dashboard-record-count>불러오는 중</strong>
              <span>오늘 완료된 작업</span>
            </div>
            <div class="creator-dashboard-trend is-today" data-dashboard-trend aria-label="최근 7일 전체 작업 추이"></div>
          </div>
        </article>
      </div>
    </section>

    <div class="creator-dashboard-primary-grid">
      <section class="creator-dashboard-panel creator-dashboard-workflow" aria-labelledby="creator-dashboard-workflow-title">
        <div class="creator-dashboard-section-heading">
          <div>
            <h2 id="creator-dashboard-workflow-title">스마트 콘텐츠 제작 워크플로우</h2>
            <p>주제를 정하고 플랫폼을 선택해 콘텐츠를 만든 뒤 결과를 확인합니다.</p>
          </div>
        </div>
        <ol class="creator-dashboard-workflow-steps">
          <li><span>1</span><div><strong>주제 입력</strong><small>키워드 또는 주제 정하기</small></div></li>
          <li><span>2</span><div><strong>콘텐츠 생성</strong><small>AI 텍스트와 이미지 준비</small></div></li>
          <li><span>3</span><div><strong>미리보기 및 검토</strong><small>결과를 확인하고 수정</small></div></li>
          <li><span>4</span><div><strong>저장 또는 발행</strong><small>선택한 방식으로 완료</small></div></li>
        </ol>
        <div class="creator-dashboard-quick-actions">
          <button type="button" data-dashboard-target="blog">블로그 만들기</button>
          <button type="button" class="secondary" data-dashboard-target="instagram">인스타그램 카드</button>
          <button type="button" class="secondary" data-dashboard-target="youtube">유튜브 콘텐츠</button>
          <button type="button" class="secondary" data-dashboard-target="history">발행 기록</button>
          <button type="button" class="secondary" data-dashboard-target="settings">설정</button>
        </div>
      </section>

      <section class="creator-dashboard-panel creator-dashboard-connections" aria-labelledby="creator-dashboard-status-title">
        <div class="creator-dashboard-section-heading">
          <div>
            <h2 id="creator-dashboard-status-title">도구 및 채널 연결 상태</h2>
            <p>저장된 로컬 설정을 기준으로 표시합니다.</p>
          </div>
          <button type="button" class="secondary" data-dashboard-target="settings">설정</button>
        </div>
        <div class="creator-dashboard-status-grid">
          <article class="creator-dashboard-card creator-dashboard-status-card" data-dashboard-card="text-ai">
            <div class="creator-dashboard-card-heading">
              <div><span class="creator-dashboard-card-kicker">AI</span><h3>텍스트 AI</h3></div>
              <span class="creator-dashboard-state-badge is-loading" data-dashboard-badge>확인 중</span>
            </div>
            <p class="creator-dashboard-connection-meta">
              <span data-dashboard-provider>확인 중</span>
              <span data-dashboard-model>확인 중</span>
              <span data-dashboard-key>확인 중</span>
            </p>
          </article>

          <article class="creator-dashboard-card creator-dashboard-status-card" data-dashboard-card="image-ai">
            <div class="creator-dashboard-card-heading">
              <div><span class="creator-dashboard-card-kicker">AI</span><h3>이미지 AI</h3></div>
              <span class="creator-dashboard-state-badge is-loading" data-dashboard-badge>확인 중</span>
            </div>
            <p class="creator-dashboard-connection-meta">
              <span data-dashboard-provider>확인 중</span>
              <span data-dashboard-model>확인 중</span>
              <span data-dashboard-key>확인 중</span>
            </p>
          </article>

          <article class="creator-dashboard-card creator-dashboard-status-card" data-dashboard-card="naver">
            <div class="creator-dashboard-card-heading">
              <div><span class="creator-dashboard-card-kicker is-blog">B</span><h3>네이버 블로그</h3></div>
              <span class="creator-dashboard-state-badge is-loading" data-dashboard-badge>확인 중</span>
            </div>
            <p class="creator-dashboard-connection-meta">
              <span data-dashboard-account-status>확인 중</span>
            </p>
          </article>

          <article class="creator-dashboard-card creator-dashboard-status-card" data-dashboard-card="instagram">
            <div class="creator-dashboard-card-heading">
              <div><span class="creator-dashboard-card-kicker is-instagram">I</span><h3>인스타그램</h3></div>
              <span class="creator-dashboard-state-badge is-loading" data-dashboard-badge>확인 중</span>
            </div>
            <p class="creator-dashboard-connection-meta">
              <span data-dashboard-account-status>확인 중</span>
            </p>
          </article>
        </div>
      </section>
    </div>

    <div class="creator-dashboard-secondary-grid">
      <section class="creator-dashboard-panel creator-dashboard-activity-section" aria-labelledby="creator-dashboard-activity-title">
        <div class="creator-dashboard-section-heading">
          <div>
            <h2 id="creator-dashboard-activity-title">최근 발행 및 생성 기록</h2>
            <p>최근 로컬 작업을 최대 5건까지 한눈에 확인합니다.</p>
          </div>
          <button type="button" class="secondary" data-dashboard-target="history">전체 기록</button>
        </div>
        <div class="creator-dashboard-activity-panel">
          <ol id="creator-dashboard-activity-list" class="creator-dashboard-activity-list" aria-label="최근 로컬 작업 기록"></ol>
          <p id="creator-dashboard-activity-empty" class="creator-dashboard-empty">최근 작업을 불러오는 중입니다.</p>
        </div>
      </section>

      <section class="creator-dashboard-panel creator-dashboard-notice-section" aria-labelledby="creator-dashboard-notice-title">
        <div class="creator-dashboard-section-heading">
          <div>
            <h2 id="creator-dashboard-notice-title">빠른 설정 및 확인</h2>
            <p>작업 전에 필요한 연결 상태를 확인합니다.</p>
          </div>
        </div>
        <ul id="creator-dashboard-notice-list" class="creator-dashboard-notice-list" aria-label="설정 및 작업 주의 항목">
          <li class="creator-dashboard-notice is-neutral"><div><strong>상태 확인 중</strong><span>로컬 정보를 불러오고 있습니다.</span></div></li>
        </ul>
      </section>
    </div>
  `;

  const clock = formatDashboardClock();
  setText(container, '#creator-dashboard-current-date', clock.date);
  setText(container, '#creator-dashboard-current-time', clock.time);
}

export async function initDashboardView(container, { navigate, loaders: loaderOverrides } = {}) {
  const renderVersion = (dashboardRenderVersions.get(container) || 0) + 1;
  dashboardRenderVersions.set(container, renderVersion);
  renderDashboardShell(container);
  wireDashboardNavigation(container, navigate);

  const loaders = getDashboardLoaders(loaderOverrides);
  const [settingsResult, historyResult, instagramResult] = await Promise.allSettled([
    runOptionalLoader(loaders.settings),
    runOptionalLoader(loaders.history),
    runOptionalLoader(loaders.instagram),
  ]);

  // 사용자가 빠르게 다른 화면으로 이동한 경우 이전 조회 결과가 새 화면을 덮어쓰지 않게 한다.
  if (dashboardRenderVersions.get(container) !== renderVersion || !container.isConnected) {
    return;
  }

  renderAiStatus(container, 'text', settingsResult);
  renderAiStatus(container, 'image', settingsResult);
  renderNaverStatus(container, settingsResult);
  renderInstagramStatus(container, instagramResult);

  let entries = null;
  try {
    entries = renderRecordSummary(container, historyResult);
  } catch {
    renderRecordSummary(container, { status: 'rejected' });
    entries = null;
  }
  const historyAvailable = Array.isArray(entries);
  renderRecentActivity(container, entries || [], historyAvailable);
  renderNotices(container, settingsResult, instagramResult, historyAvailable);
  wireDashboardNavigation(container, navigate);

  const hasPartialError =
    settingsResult.status === 'rejected' ||
    historyResult.status === 'rejected' ||
    instagramResult.status === 'rejected' ||
    !historyAvailable;
  const error = container.querySelector('#creator-dashboard-error');
  if (error) error.hidden = !hasPartialError;

  container.setAttribute('aria-busy', 'false');
  setText(
    container,
    '#creator-dashboard-live',
    hasPartialError ? '일부 상태를 제외하고 대시보드를 갱신했습니다.' : '대시보드를 갱신했습니다.'
  );
}
