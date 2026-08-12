/**
 * [인스타그램 카드뉴스 제작 공정]
 *
 * 비개발자를 위한 설명:
 * - 키워드 하나로 '카드뉴스'(옆으로 넘겨 보는 여러 장짜리 이미지 게시물)를 만듭니다.
 *
 * - 만드는 순서:
 *     1) 글쓰기 AI에게 카드별 문구, 게시물 본문, 해시태그를 받는다.        (stage: writing)
 *     2) 이미지 AI에게 카드마다 들어갈 배경 사진을 만든다. (2장씩 동시에)  (stage: illustrating)
 *     3) 배경 사진 위에 글자를 얹어 최종 카드 이미지를 완성한다.           (stage: rendering)
 *     4) 문구(caption.txt)와 정보(post.json)를 결과 폴더에 함께 저장한다.   (stage: done)
 *
 * - 3번의 '글자 얹기'는 어떻게 하나요?
 *   포토샵 같은 그래픽 프로그램 대신, 웹페이지(HTML) 한 장을 만들고 그것을 화면 캡처합니다.
 *   즉 "배경 사진 + 제목 + 설명"을 웹페이지로 그린 뒤 1080x1350 크기로 사진을 찍는 방식입니다.
 *   웹 기술로 글자 크기·줄바꿈·그림자를 정교하게 다룰 수 있어 이 방법을 씁니다.
 *
 * - 실제 인스타그램 업로드는 이 파일이 아니라 publisher.js가 담당합니다.
 */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const textProviders = require('../../core/providers/text');
const imageProviders = require('../../core/providers/image');
const { resolveConfiguredProvider } = require('../../core/providers/configuredProvider');
const { buildSafeImagePrompt } = require('../../core/pipeline');
const { mapWithConcurrency } = require('../../core/concurrency');
const { MIN_CARD_COUNT, MAX_CARD_COUNT, normalizeCardCount } = require('../../core/providers/text/instagramSchema');

// 배경 이미지를 한 번에 몇 장씩 만들지. 2장씩이면 속도와 API 제한 사이의 균형이 좋다.
const IMAGE_GENERATION_CONCURRENCY = 2;

/** 사용자가 입력한 주제가 1~100자인지 확인하고 공백을 정리한다. */
function validateKeyword(keyword) {
  const value = String(keyword || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!value || [...value].length > 100) {
    throw new Error('주제는 1~100자로 입력해 주세요.');
  }
  return value;
}

function validateCardCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < MIN_CARD_COUNT || count > MAX_CARD_COUNT) {
    throw new Error(`카드 수는 ${MIN_CARD_COUNT}~${MAX_CARD_COUNT}개로 선택해 주세요.`);
  }
  return normalizeCardCount(count);
}

/**
 * 결과물을 담을 폴더 이름을 만든다. 예) 2026-08-12T09-30-00-000Z_홈카페원두고르기
 * 시간을 앞에 붙여 최신 작업이 목록 위쪽에 모이게 하고,
 * 폴더 이름에 쓸 수 없는 문자(\ / : * ? " < > |)는 공백으로 바꾼다.
 */
function createJobFolderName(keyword) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeKeyword = keyword
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);
  return `${timestamp}_${safeKeyword || 'instagram'}`;
}

/**
 * 글자에 들어 있는 <, >, & 같은 기호를 안전한 형태로 바꾼다.
 * 이 처리를 하지 않으면 AI가 쓴 문구 속 기호가 웹페이지 명령으로 잘못 해석되어
 * 카드 디자인이 깨질 수 있다.
 */
function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toDataUri(imagePath) {
  return `data:image/png;base64,${fs.readFileSync(imagePath).toString('base64')}`;
}

/**
 * 카드 한 장의 디자인을 웹페이지(HTML) 형태로 그린다. 이 페이지를 캡처하면 카드 이미지가 된다.
 *
 * 카드 구성 (위에서 아래로):
 *   · 배경 사진 위에 어두운 반투명 막을 덮어 글자가 잘 보이게 한다 (rgba(6,10,16,0.60))
 *   · 상단 라벨   : 첫 장은 'SAVE THIS', 나머지는 'POINT 02' 형식
 *   · 큰 제목     : 첫 장은 카드뉴스 전체 제목, 나머지는 그 카드의 소제목
 *   · 설명 문장
 *   · 하단        : 'AUTOM CREATOR' 표시와 '02 / 05' 같은 장수 표시
 *
 * 크기 1080x1350은 인스타그램 세로형 게시물의 권장 규격이다.
 */
function renderCardHtml({ title, card, cardIndex, cardCount, backgroundDataUri }) {
  const displayTitle = cardIndex === 1 ? title : card.headline;
  const eyebrow = cardIndex === 1 ? 'SAVE THIS' : `POINT ${String(cardIndex).padStart(2, '0')}`;
  const footer = `${String(cardIndex).padStart(2, '0')} / ${String(cardCount).padStart(2, '0')}`;

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <style>
      * { box-sizing: border-box; }
      html, body { width: 1080px; height: 1350px; margin: 0; }
      body { color: #ffffff; font-family: "Malgun Gothic", "Apple SD Gothic Neo", Arial, sans-serif; }
      .card { position: relative; isolation: isolate; width: 1080px; height: 1350px; overflow: hidden; background: #20242b; }
      .background { position: absolute; z-index: 0; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .card::before { content: ""; position: absolute; z-index: 1; inset: 0; background: rgba(6, 10, 16, 0.60); }
      .content { position: relative; z-index: 2; display: flex; flex-direction: column; height: 100%; padding: 92px 84px 72px; }
      .eyebrow { align-self: flex-start; border: 2px solid rgba(255,255,255,0.95); background: rgba(0,0,0,0.32); padding: 10px 15px; font-size: 24px; font-weight: 700; letter-spacing: 1px; text-shadow: 0 2px 6px rgba(0,0,0,0.9); }
      .copy { margin-top: auto; max-width: 860px; }
      h1 { margin: 0 0 34px; font-size: 76px; line-height: 1.17; letter-spacing: 0; word-break: keep-all; overflow-wrap: break-word; text-shadow: 0 3px 12px rgba(0,0,0,0.96); }
      p { margin: 0; font-size: 35px; line-height: 1.55; font-weight: 500; word-break: keep-all; overflow-wrap: break-word; text-shadow: 0 2px 9px rgba(0,0,0,0.96); }
      .footer { display: flex; align-items: center; justify-content: space-between; margin-top: 58px; padding-top: 24px; border-top: 2px solid rgba(255,255,255,0.68); font-size: 25px; font-weight: 700; letter-spacing: 1px; }
      .footer-mark { color: #ff765f; }
    </style>
  </head>
  <body>
    <article class="card">
      <img class="background" src="${backgroundDataUri}" alt="" />
      <div class="content">
        <div class="eyebrow">${escapeHtml(eyebrow)}</div>
        <div class="copy">
          <h1>${escapeHtml(displayTitle)}</h1>
          <p>${escapeHtml(card.body)}</p>
          <div class="footer"><span class="footer-mark">AUTOM CREATOR</span><span>${escapeHtml(footer)}</span></div>
        </div>
      </div>
    </article>
  </body>
</html>`;
}

function buildBackgroundPrompt(card) {
  return buildSafeImagePrompt(
    `Portrait editorial photograph for an educational Instagram carousel slide. ${card.imagePrompt}. ` +
      'Use a calm, high-quality composition with visual breathing room for a text overlay. ' +
      'No readable text, numbers, logo, brand name, packaging label, watermark, collage, or before-and-after layout.'
  );
}

/**
 * 카드 이미지를 실제로 만들어 낸다.
 *
 * 방법: 화면에 보이지 않는 브라우저(headless)를 하나 띄우고, 카드 HTML을 표시한 뒤
 *       그 화면을 PNG로 캡처해 저장한다. 카드 수만큼 반복한다.
 */
async function renderCards(cards, title, workDir, onProgress) {
  // 설치본에는 로그인 창과 카드 합성에 함께 쓰는 일반 Chromium이 들어 있다.
  // 실행 파일을 직접 지정하면 Playwright가 별도의 headless shell을 찾지 않아
  // 새 컴퓨터에서도 브라우저를 추가로 설치하지 않고 카드를 만들 수 있다.
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromium.executablePath(),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
    const renderedCards = [];
    for (const card of cards) {
      const outputPath = path.join(workDir, `card_${card.index}.png`);
      await page.setContent(
        renderCardHtml({
          title,
          card,
          cardIndex: card.index,
          cardCount: cards.length,
          backgroundDataUri: toDataUri(card.backgroundPath),
        }),
        { waitUntil: 'load' }
      );
      await page.screenshot({ path: outputPath, type: 'png' });
      onProgress?.({ stage: 'rendering', current: card.index, total: cards.length });
      renderedCards.push({
        ...card,
        path: outputPath,
        fileUrl: pathToFileURL(outputPath).href,
      });
    }
    await page.close();
    return renderedCards;
  } finally {
    await browser.close();
  }
}

/**
 * 결과 폴더에 부가 파일 2개를 저장한다.
 *  · caption.txt : 인스타그램에 붙여넣을 본문 글 (본문 + 마무리 문장 + 해시태그)
 *  · post.json   : 나중에 프로그램이 다시 읽을 수 있도록 정리한 상세 정보
 * 자동 발행을 쓰지 않고 직접 올리고 싶은 사용자는 caption.txt만 복사하면 된다.
 */
function writeBundle(workDir, content) {
  const captionText = `${content.caption}\n\n${content.callToAction}\n\n${content.tags.map((tag) => `#${tag}`).join(' ')}`;
  fs.writeFileSync(path.join(workDir, 'caption.txt'), captionText, 'utf8');
  fs.writeFileSync(
    path.join(workDir, 'post.json'),
    JSON.stringify(
      {
        keyword: content.keyword,
        title: content.title,
        caption: content.caption,
        callToAction: content.callToAction,
        tags: content.tags,
        cards: content.cards.map(({ index, headline, body, imagePrompt, path: imagePath }) => ({
          index,
          headline,
          body,
          imagePrompt,
          imagePath,
        })),
      },
      null,
      2
    ),
    'utf8'
  );
  return captionText;
}

/**
 * [메인 함수] 키워드 하나로 카드뉴스 한 세트를 완성한다.
 * 화면의 '카드뉴스 만들기' 버튼이 최종적으로 실행하는 기능이다.
 */
async function generateCarousel({ keyword, cardCount, settings, onProgress }) {
  const normalizedKeyword = validateKeyword(keyword);
  const normalizedCardCount = validateCardCount(cardCount);
  const textConfig = resolveConfiguredProvider(settings, 'text', textProviders);
  const imageConfig = resolveConfiguredProvider(settings, 'image', imageProviders);
  const textProviderId = textConfig.providerId;
  const imageProviderId = imageConfig.providerId;
  const textApiKey = textConfig.apiKey;
  const imageApiKey = imageConfig.apiKey;

  const outputFolder = String(settings?.outputFolder || '').trim();
  if (!outputFolder) throw new Error('설정에서 저장 폴더를 먼저 선택해 주세요.');

  const workDir = path.join(outputFolder, 'instagram', createJobFolderName(normalizedKeyword));
  fs.mkdirSync(workDir, { recursive: true });

  const textProvider = textProviders.get(textProviderId);
  const imageProvider = imageProviders.get(imageProviderId);
  onProgress?.({ stage: 'writing', current: 0, total: normalizedCardCount });
  const draft = await textProvider.generateInstagramCarousel({
    keyword: normalizedKeyword,
    cardCount: normalizedCardCount,
    model: textConfig.model,
    apiKey: textApiKey,
  });

  let completedImageCount = 0;
  onProgress?.({ stage: 'illustrating', current: 0, total: draft.cards.length });
  const cardsWithBackgrounds = await mapWithConcurrency(
    draft.cards,
    IMAGE_GENERATION_CONCURRENCY,
    async (card, index) => {
      const cardIndex = index + 1;
      const backgroundPath = path.join(workDir, `background_${cardIndex}.png`);
      await imageProvider.generateImage({
        prompt: buildBackgroundPrompt(card),
        model: imageConfig.model,
        apiKey: imageApiKey,
        outputPath: backgroundPath,
      });
      completedImageCount += 1;
      onProgress?.({ stage: 'illustrating', current: completedImageCount, total: draft.cards.length });
      return { ...card, index: cardIndex, backgroundPath };
    }
  );

  const cards = await renderCards(cardsWithBackgrounds, draft.title, workDir, onProgress);
  const content = {
    keyword: normalizedKeyword,
    workDir,
    title: draft.title,
    caption: draft.caption,
    tags: draft.tags,
    callToAction: draft.callToAction,
    cards,
  };
  content.captionText = writeBundle(workDir, content);
  onProgress?.({ stage: 'done', current: cards.length, total: cards.length });
  return content;
}

module.exports = {
  generateCarousel,
  _test: {
    validateKeyword,
    validateCardCount,
    renderCardHtml,
    createJobFolderName,
    mapWithConcurrency,
    IMAGE_GENERATION_CONCURRENCY,
  },
};
