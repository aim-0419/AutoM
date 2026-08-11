/**
 * 블로그, 인스타그램, YouTube가 같은 콘텐츠 안전 기준을 사용하도록 모아 둔 파일이다.
 * 콘텐츠 분야 자체는 제한하지 않지만, 판단에 주의가 필요한 주제에는 추가 안내를 적용한다.
 */
const GENERAL_CONTENT_SAFETY_RULES = `공통 안전 기준:
- 사용자가 입력한 주제를 다른 분야로 바꾸거나 특정 분야로 제한하지 마세요.
- 확인할 수 없는 사실, 통계, 출처 URL, 전문가 발언, 개인 경험을 지어내지 마세요.
- 다른 사람의 글이나 영상 구성을 베끼지 말고, 입력된 주제에 맞는 독창적인 설명을 작성하세요.
- 건강·의료 주제는 진단·치료·완치·효과를 보장하거나 구체적인 복용량을 단정하지 말고 전문가 상담이 필요한 경우를 안내하세요.
- 금융·투자 주제는 원금·수익·대출 승인을 보장하거나 개인 맞춤 투자 조언처럼 표현하지 마세요.
- 법률 주제는 승소·처벌 여부·합법성을 단정하거나 개인 사건에 대한 확정적인 법률 자문처럼 표현하지 마세요.
- 위험한 작업이나 활동을 다룰 때는 보호 장비, 공식 지침, 전문가 확인 등 필요한 주의사항을 생략하지 마세요.
- 불법 행위, 사기, 개인정보 침해, 혐오·차별, 성적 착취를 조장하는 내용을 작성하지 마세요.`;

const SENSITIVE_TOPIC_RULES = Object.freeze([
  Object.freeze({
    id: 'health',
    patterns: Object.freeze([
      /건강|의학|의료|질병|질환|증상|치료|완치|의약품|처방|복용|영양제|비타민|병원|의사|혈압|혈당|통증|다이어트|수면장애/u,
    ]),
    disclaimer: '본 글은 일반적인 건강 정보 제공을 목적으로 하며, 의학적 진단이나 치료를 대체하지 않습니다.',
  }),
  Object.freeze({
    id: 'finance',
    patterns: Object.freeze([
      /금융|투자|주식|펀드|코인|가상자산|부동산|대출|보험|재테크|수익률|배당|채권|연금|세금|절세/u,
    ]),
    disclaimer: '본 글은 일반적인 금융 정보이며, 개인의 투자·대출·세무 판단을 대신하지 않습니다.',
  }),
  Object.freeze({
    id: 'legal',
    patterns: Object.freeze([
      /법률|법적|소송|고소|고발|계약서|처벌|범죄|변호사|노무|노동법|저작권|상표권|특허|행정심판/u,
    ]),
    disclaimer: '본 글은 일반적인 법률 정보이며, 개별 사건에 대한 법률 자문을 대신하지 않습니다.',
  }),
]);

const KNOWN_DISCLAIMERS = new Set(SENSITIVE_TOPIC_RULES.map((rule) => rule.disclaimer));

function collectContentText(content) {
  // 생성 결과 전체가 아니라 주제 판별에 필요한 대표 필드만 합쳐 과도한 오탐을 줄인다.
  if (typeof content === 'string') return content;
  if (!content || typeof content !== 'object') return '';
  return [
    content.keyword,
    content.title,
    content.body,
    content.caption,
    content.description,
    content.channelTheme,
  ]
    .map((value) => String(value || ''))
    .join(' ');
}

function detectSensitiveDomains(content) {
  const text = collectContentText(content);
  if (!text) return [];
  return SENSITIVE_TOPIC_RULES.filter((rule) => rule.patterns.some((pattern) => pattern.test(text))).map(
    (rule) => rule.id
  );
}

function getSensitiveDisclaimers(content) {
  const domains = new Set(detectSensitiveDomains(content));
  return SENSITIVE_TOPIC_RULES.filter((rule) => domains.has(rule.id)).map((rule) => rule.disclaimer);
}

function renderDisclaimerBlock(disclaimers) {
  const unique = [...new Set((Array.isArray(disclaimers) ? disclaimers : []).filter((item) => KNOWN_DISCLAIMERS.has(item)))];
  return unique.length > 0 ? `\n\n---\n${unique.join('\n')}` : '';
}

function splitGeneratedDisclaimerBlock(body) {
  // 프로그램이 붙인 고지문만 분리한다. 사용자가 직접 작성한 구분선과 문장은 그대로 보존한다.
  const source = String(body || '');
  const marker = '\n\n---\n';
  const markerIndex = source.lastIndexOf(marker);
  if (markerIndex < 0) return { body: source, disclaimers: [] };

  const trailingLines = source
    .slice(markerIndex + marker.length)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (trailingLines.length === 0 || trailingLines.some((line) => !KNOWN_DISCLAIMERS.has(line))) {
    return { body: source, disclaimers: [] };
  }

  return {
    body: source.slice(0, markerIndex).trimEnd(),
    disclaimers: trailingLines,
  };
}

function appendSensitiveDisclaimers(body, content) {
  const existing = splitGeneratedDisclaimerBlock(body);
  const disclaimers = [...new Set([...existing.disclaimers, ...getSensitiveDisclaimers(content)])];
  return `${existing.body.trimEnd()}${renderDisclaimerBlock(disclaimers)}`;
}

module.exports = {
  GENERAL_CONTENT_SAFETY_RULES,
  SENSITIVE_TOPIC_RULES,
  appendSensitiveDisclaimers,
  detectSensitiveDomains,
  getSensitiveDisclaimers,
  renderDisclaimerBlock,
  splitGeneratedDisclaimerBlock,
};
