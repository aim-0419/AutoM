/**
 * 인터넷·API 비용 없이 핵심 안전 규칙을 확인하는 자동 테스트다.
 * 글 형식, SEO 품질 검사, 내부링크 선택, 줄바꿈, 설정 제한, 자동발행 대기를 대상으로 한다.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const articleSchema = require('../backend/core/providers/text/articleSchema');
const { toKoreanErrorMessage } = require('../backend/core/providers/errorMessage');
const contentQuality = require('../backend/core/contentQuality');
const pipeline = require('../backend/core/pipeline');
const schedule = require('../backend/core/schedule');
const { normalizeSettings } = require('../backend/core/settingsValidation');
const naverPublisher = require('../backend/features/blog/publisher');
const ipc = require('../backend/shared/ipc');

function buildValidBody() {
  // 각 테스트가 공통으로 쓸 "정상적인 블로그 글" 본문을 만든다.
  // 일부 테스트는 이 결과에서 한 항목만 고쳐 오류가 제대로 잡히는지 확인한다.
  const intro =
    '루테인 눈 영양제를 고를 때는 광고 문구보다 원료 표시와 섭취 목적, 현재 생활 습관을 함께 살펴야 합니다. 이 글은 제품 선택 전에 확인할 내용을 차분히 정리합니다.';
  const details = Array.from({ length: 12 }, (_, index) => {
    const number = index + 1;
    return `확인 항목 ${number}에서는 표시된 원료와 섭취 상황을 실제 생활에 맞춰 살펴봅니다. 한 가지 정보만으로 결론을 내리기보다 식사, 수면, 화면 사용 시간과 현재 불편함을 함께 기록하면 불필요한 선택을 줄일 수 있습니다. 변화가 크거나 불편함이 이어진다면 스스로 판단을 미루고 전문가에게 현재 상태를 설명하는 과정도 중요합니다.`;
  });

  return [
    intro,
    '',
    '## 성분표에서 먼저 살펴볼 내용',
    '',
    ...details.slice(0, 4).flatMap((paragraph) => [paragraph, '']),
    '[IMAGE_1]',
    '',
    '## 생활 습관과 함께 비교할 기준',
    '',
    ...details.slice(4, 8).flatMap((paragraph) => [paragraph, '']),
    '- 원료명과 함량 표시를 읽습니다.',
    '- 현재 먹는 제품과 성분이 겹치는지 확인합니다.',
    '- 불편함이 지속되면 전문가와 상담합니다.',
    '',
    '[IMAGE_2]',
    '',
    '## 섭취 전에 놓치기 쉬운 주의점',
    '',
    ...details.slice(8).flatMap((paragraph) => [paragraph, '']),
    '[IMAGE_3]',
  ].join('\n');
}

function buildValidContent() {
  // 이미지 위치·태그·제목까지 갖춘 기본 테스트 자료다.
  return {
    keyword: '루테인 눈 영양제',
    title: '루테인 눈 영양제 선택 전에 확인할 실전 기준',
    body: buildValidBody(),
    tags: ['루테인', '눈영양제', '눈건강', '성분확인', '섭취주의', '생활습관'],
    images: [1, 2, 3].map((index) => ({ index, path: `C:\\temp\\image_${index}.png` })),
  };
}

function buildArticleJson(overrides = {}) {
  // AI가 돌려준 것처럼 보이는 JSON 문자열을 만들어 파서가 형식을 검증하는지 시험한다.
  const content = buildValidContent();
  return JSON.stringify({
    title: content.title,
    body: content.body,
    imagePrompts: ['first scene', 'second scene', 'third scene'],
    tags: content.tags,
    ...overrides,
  });
}

test('정상 SEO 구조는 스키마와 자동 품질 점검을 통과한다', () => {
  const content = buildValidContent();
  assert.ok([...content.body].length >= 1800 && [...content.body].length <= 3220);
  const parsed = articleSchema.parseArticleResponse(buildArticleJson(), { minChars: 1800, maxChars: 2800 });
  assert.equal(parsed.imagePrompts.length, 3);

  const report = contentQuality.auditContent(content);
  assert.equal(report.passed, true, JSON.stringify(report.errors));
  assert.deepEqual(report.metrics, {
    titleChars: [...content.title].length,
    bodyChars: [...content.body].length,
    headings: 3,
    images: 3,
    tags: 6,
    internalLinks: 0,
    keywordMentions: 1,
    maxHistorySimilarity: 0,
  });
});

test('이미지 1장, 태그 부족, 소제목 부족 응답은 생성 단계에서 거부한다', () => {
  const oneImageBody = buildValidBody().replace('\n[IMAGE_2]', '').replace('\n[IMAGE_3]', '');
  assert.throws(
    () => articleSchema.parseArticleResponse(buildArticleJson({ body: oneImageBody, imagePrompts: ['only scene'] })),
    /2~4개/
  );
  assert.throws(
    () => articleSchema.parseArticleResponse(buildArticleJson({ tags: ['하나', '둘', '셋', '넷'] })),
    /최소 5개/
  );
  const oneHeadingBody = buildValidBody().replace('## 생활 습관과 함께 비교할 기준', '생활 습관과 함께 비교할 기준').replace(
    '## 섭취 전에 놓치기 쉬운 주의점',
    '섭취 전에 놓치기 쉬운 주의점'
  );
  assert.throws(
    () => articleSchema.parseArticleResponse(buildArticleJson({ body: oneHeadingBody })),
    /소제목은 2~4개/
  );
});

test('AI 재시도에는 첫 응답의 구체적인 검증 오류가 전달된다', async () => {
  let retryError;
  const article = await articleSchema.generateArticleWithRetry(async (attempt, lastError) => {
    if (attempt === 0) return '{"title":"짧음"}';
    retryError = lastError;
    return buildArticleJson();
  });
  assert.ok(retryError instanceof Error);
  assert.match(retryError.message, /body 필드/);
  assert.equal(article.imagePrompts.length, 3);
});

test('내부링크는 핵심 주제가 겹치는 실제 게시물만 고르고 고지문 앞에 넣는다', () => {
  const content = {
    ...buildValidContent(),
    body: `${buildValidBody()}\n\n---\n본 글은 일반적인 건강 정보 제공을 목적으로 하며, 의학적 진단이나 치료를 대체하지 않습니다.`,
  };
  const historyEntries = [
    {
      status: 'success',
      keyword: '루테인 섭취 주의사항',
      title: '루테인 섭취 전에 살펴볼 주의사항',
      url: 'https://blog.naver.com/example/123456789012',
      date: '2026-07-10T00:00:00.000Z',
    },
    {
      status: 'success',
      keyword: '마그네슘 부족 증상',
      title: '마그네슘 부족 증상과 생활 관리',
      url: 'https://blog.naver.com/example/123456789013',
      date: '2026-07-11T00:00:00.000Z',
    },
    {
      status: 'success',
      keyword: '루테인 발행 테스트',
      title: '루테인 publish test',
      url: 'https://blog.naver.com/example/123456789014',
      date: '2026-07-12T00:00:00.000Z',
    },
    {
      status: 'success',
      visibility: 'private',
      keyword: '루테인 섭취 방법',
      title: '루테인 섭취 방법과 확인 기준',
      url: 'https://blog.naver.com/example/123456789016',
      date: '2026-07-13T00:00:00.000Z',
    },
    {
      status: 'success',
      keyword: '루테인 선택 기준',
      title: '루테인 선택 기준 예약 글',
      url: 'https://blog.naver.com/example/123456789017',
      date: '2026-07-14T00:00:00.000Z',
      scheduledAt: '2999-01-01T00:00:00.000Z',
    },
  ];

  const linked = pipeline.appendInternalLinks(content, historyEntries);
  assert.equal(linked.internalLinks.length, 1);
  assert.match(linked.body, /123456789012/);
  assert.doesNotMatch(linked.body, /123456789013|123456789014|123456789016|123456789017/);
  assert.ok(linked.body.endsWith('의학적 진단이나 치료를 대체하지 않습니다.'));

  const report = contentQuality.auditContent(linked);
  assert.equal(report.passed, true, JSON.stringify(report.errors));
  assert.equal(report.metrics.internalLinks, 1);
});

test('과장 표현, 키워드 남용, 외부 링크, 동일 본문은 발행을 차단한다', () => {
  const base = buildValidContent();
  const overclaim = contentQuality.auditContent({ ...base, body: `${base.body}\n\n이 제품은 100% 효과를 보장합니다.` });
  assert.ok(overclaim.errors.some((item) => item.code === 'medical-overclaim'));

  const stuffed = contentQuality.auditContent({
    ...base,
    body: `${base.body}\n\n${Array(11).fill(base.keyword).join(' ')}`,
  });
  assert.ok(stuffed.errors.some((item) => item.code === 'keyword-stuffing'));

  const externalLink = contentQuality.auditContent({
    ...base,
    body: `${base.body}\n\n## 함께 읽으면 좋은 글\n\n위험한 링크\nhttps://example.com/post`,
  });
  assert.ok(externalLink.errors.some((item) => item.code === 'invalid-internal-link'));

  const duplicateMarker = contentQuality.auditContent({
    ...base,
    body: base.body.replace('[IMAGE_2]', '[IMAGE_1]'),
  });
  assert.ok(duplicateMarker.errors.some((item) => item.code === 'image-marker-order'));

  const firstReport = contentQuality.auditContent(base);
  const duplicate = contentQuality.auditContent(base, {
    historyEntries: [
      {
        status: 'success',
        keyword: '다른 키워드',
        title: '완전히 다른 제목으로 저장된 기존 글입니다',
        url: 'https://blog.naver.com/example/123456789015',
        ...contentQuality.buildHistoryQualityFields(firstReport),
      },
    ],
  });
  assert.ok(duplicate.errors.some((item) => item.code === 'duplicate-content'));
});

test('설정값은 운영 가능한 범위로 보정된다', () => {
  const defaults = {
    text: { provider: 'openai', apiKeys: { openai: '' }, models: { openai: 'gpt-default' } },
    image: { provider: 'openai', apiKeys: { openai: '' }, models: { openai: 'image-default' } },
    naver: { blogId: '', loggedIn: false },
    youtubeProfile: { channelTheme: '', targetAudience: '', creatorPerspective: '' },
    publishDefaults: {
      category: '',
      visibility: 'public',
      autoIntervalMinutes: 60,
      maxImages: 3,
      insertDisclaimer: true,
    },
    outputFolder: 'C:\\output',
  };
  const normalized = normalizeSettings(
    {
      ...defaults,
      publishDefaults: { ...defaults.publishDefaults, autoIntervalMinutes: 1, maxImages: 99 },
      youtubeProfile: {
        channelTheme: `  ${'가'.repeat(220)}  `,
        targetAudience: ' 직장인 시청자 ',
        creatorPerspective: ' 실제 경험 ',
      },
    },
    defaults
  );
  assert.equal(normalized.publishDefaults.autoIntervalMinutes, 30);
  assert.equal(normalized.publishDefaults.maxImages, 4);
  assert.equal(normalized.youtubeProfile.channelTheme.length, 200);
  assert.equal(normalized.youtubeProfile.targetAudience, '직장인 시청자');
  assert.equal(normalized.youtubeProfile.creatorPerspective, '실제 경험');
});

test('API 결제 상한과 순간적인 요청 한도를 서로 다른 안내로 보여 준다', () => {
  assert.match(
    toKoreanErrorMessage({ status: 400, message: '400 Billing hard limit has been reached.' }),
    /결제 한도/
  );
  assert.match(
    toKoreanErrorMessage({ status: 429, code: 'insufficient_quota', message: 'You exceeded your current quota.' }),
    /결제 한도/
  );
  assert.match(toKoreanErrorMessage({ status: 429, message: 'Rate limit reached.' }), /요청 한도/);
});

test('모든 이미지 프롬프트에는 가짜 라벨과 의료 오해 방지 조건이 붙는다', () => {
  const prompt = pipeline.buildSafeImagePrompt('Two supplement containers on a wooden table');
  assert.match(prompt, /Do not include any visible or readable text/);
  assert.match(prompt, /plain, unbranded, and label-free/);
  assert.match(prompt, /Do not create before-and-after imagery/);
});

test('원래 이미지 설명이 실패하면 안전한 대체 장면으로 바꿔 다시 생성한다', async () => {
  const textProviders = require('../backend/core/providers/text');
  const imageProviders = require('../backend/core/providers/image');
  const originalTextGet = textProviders.get;
  const originalImageGet = imageProviders.get;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autom-image-fallback-'));
  const calls = [];

  try {
    textProviders.get = () => ({
      generateArticle: async () => ({
        title: '안전한 대체 이미지 재시도 테스트',
        body: '첫 번째 장면\n[IMAGE_1]\n두 번째 장면\n[IMAGE_2]',
        tags: ['테스트', '이미지', '재시도', '안전', '생활'],
        imagePrompts: ['a rejected medical scene', 'a normal lifestyle scene'],
      }),
    });
    imageProviders.get = () => ({
      generateImage: async ({ prompt, outputPath }) => {
        calls.push(prompt);
        if (calls.length === 1) {
          throw new Error('첫 이미지 설명 거절');
        }
        fs.writeFileSync(outputPath, 'fake image');
        return outputPath;
      },
    });

    const content = await pipeline.generateContent({
      keyword: '생활 습관',
      settings: {
        text: { provider: 'openai', apiKeys: { openai: 'text-key' }, models: { openai: 'text-model' } },
        image: { provider: 'openai', apiKeys: { openai: 'image-key' }, models: { openai: 'image-model' } },
        publishDefaults: { maxImages: 2, insertDisclaimer: false },
      },
      workDir,
    });

    assert.equal(content.images.length, 2);
    assert.equal(content.imageFailures.length, 0);
    assert.equal(calls.length, 3);
    assert.match(calls[0], /a rejected medical scene/);
    assert.doesNotMatch(calls[1], /a rejected medical scene/);
    assert.match(calls[1], /general informational article/);
    assert.match(calls[1], /Do not include any visible or readable text/);
  } finally {
    textProviders.get = originalTextGet;
    imageProviders.get = originalImageGet;
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('대체 이미지까지 실패해 두 장 미만이면 실제 실패 원인을 보여 주고 중단한다', async () => {
  const textProviders = require('../backend/core/providers/text');
  const imageProviders = require('../backend/core/providers/image');
  const originalTextGet = textProviders.get;
  const originalImageGet = imageProviders.get;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autom-image-failure-'));

  try {
    textProviders.get = () => ({
      generateArticle: async () => ({
        title: '이미지 실패 원인 테스트',
        body: '첫 장면\n[IMAGE_1]\n둘째 장면\n[IMAGE_2]',
        tags: ['테스트', '이미지', '실패', '원인', '안내'],
        imagePrompts: ['first scene', 'second scene'],
      }),
    });
    imageProviders.get = () => ({
      generateImage: async () => {
        throw new Error('API 결제 한도에 도달했습니다.');
      },
    });

    await assert.rejects(
      () =>
        pipeline.generateContent({
          keyword: '생활 습관',
          settings: {
            text: { provider: 'openai', apiKeys: { openai: 'text-key' }, models: { openai: 'text-model' } },
            image: { provider: 'openai', apiKeys: { openai: 'image-key' }, models: { openai: 'image-model' } },
            publishDefaults: { maxImages: 2, insertDisclaimer: false },
          },
          workDir,
        }),
      /이미지를 2장 이상 만들지 못했습니다.*API 결제 한도/
    );
  } finally {
    textProviders.get = originalTextGet;
    imageProviders.get = originalImageGet;
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('한글 본문은 어절을 보존해 줄을 나누고 URL은 게시물 주소로 판정한다', () => {
  const line = '긴 한글 문장을 네이버 블로그에 입력할 때 단어 중간이 아니라 어절 경계에서 자연스럽게 줄을 나눕니다.';
  const wrapped = naverPublisher._test.wrapLineForReadablePublishing(line);
  const plainLines = wrapped.map((segments) => segments.map((segment) => segment.text).join(''));
  assert.equal(plainLines.join(' ').replace(/\s+/g, ' '), line);
  assert.ok(plainLines.every((item) => [...item].length <= 42));
  assert.equal(naverPublisher._test.calculateReadableLineMaxChars(693, 15), 41);
  assert.equal(naverPublisher._test.isStandaloneUrlLine('https://blog.naver.com/example/123'), true);
  assert.equal(
    naverPublisher._test.isPublishedPostUrl('https://blog.naver.com/example/123456789012', 'example'),
    true
  );
  assert.equal(naverPublisher._test.isPublishedPostUrl('https://blog.naver.com/example?Redirect=Write&', 'example'), false);
  assert.equal(naverPublisher._test.isPublishedPostUrl('https://example.com/example/123456789012', 'example'), false);
  assert.equal(
    naverPublisher._test.extractCompletedPostUrl(
      'https://blog.naver.com/PostList.naver?blogId=example&logNo=123456789099&isAfterWrite=true',
      'example'
    ),
    'https://blog.naver.com/example/123456789099'
  );
});

test('예약발행 시각은 미래의 10분 단위로 보정되고 글마다 간격을 둔다', () => {
  const now = Date.parse('2026-07-14T00:00:00.000Z');
  assert.throws(() => schedule.normalizeScheduleAt('2026-07-14T00:10:00.000Z', now), /최소 20분/);

  const normalized = schedule.normalizeScheduleAt('2026-07-14T00:25:01.000Z', now);
  assert.equal(normalized, '2026-07-14T00:30:00.000Z');
  assert.equal(schedule.buildBatchScheduleAt(normalized, 1, 35), '2026-07-14T01:10:00.000Z');
});

test('완전자동 대량·중복 입력을 막고 대기 중 취소 요청을 즉시 처리한다', async () => {
  assert.throws(
    () => ipc._test.validateBatchRequest(['one', 'two', 'three', 'four'], 'full-auto', []),
    /최대 3개/
  );
  assert.throws(
    () => ipc._test.validateBatchRequest(['one', 'two', 'three', 'four'], 'scheduled', []),
    /최대 3개/
  );
  assert.throws(
    () => ipc._test.validateBatchRequest(['same keyword', 'same   keyword'], 'review', []),
    /중복 항목/
  );

  const progress = [];
  const shouldContinue = await ipc._test.waitForNextAutoPublish({
    minutes: 30,
    nextKeyword: 'next',
    nextIndex: 1,
    total: 2,
    sendProgress: (value) => progress.push(value),
    isCancelled: () => true,
  });
  assert.equal(shouldContinue, false);
  assert.equal(progress[0].stage, 'cancelled');

  const originalNow = Date.now;
  const originalSetTimeout = global.setTimeout;
  let virtualNow = 0;
  const countdown = [];
  try {
    Date.now = () => virtualNow;
    global.setTimeout = (callback, delay) => {
      virtualNow += delay;
      queueMicrotask(callback);
      return 0;
    };
    const completed = await ipc._test.waitForNextAutoPublish({
      minutes: 30,
      nextKeyword: 'next',
      nextIndex: 1,
      total: 2,
      sendProgress: (value) => countdown.push(value.remainingSeconds),
      isCancelled: () => false,
    });
    assert.equal(completed, true);
    assert.equal(countdown[0], 1800);
    assert.equal(countdown.at(-1), 5);
    assert.equal(virtualNow, 30 * 60 * 1000);
  } finally {
    Date.now = originalNow;
    global.setTimeout = originalSetTimeout;
  }
});
