/**
 * [예약 발행 시각 계산기]
 *
 * 비개발자를 위한 설명:
 * - 네이버 블로그의 예약 발행은 '10분 단위'로만 시간을 고를 수 있습니다(예: 14:00, 14:10 ○ / 14:07 ✕).
 * - 그래서 사용자가 입력한 시각을 항상 다음 10분 단위로 올려 맞춥니다. (14:07 → 14:10)
 * - 또한 너무 임박하거나(20분 미만) 너무 먼 미래(1년 초과)는 실수·오작동 위험이 있어 막습니다.
 * - 화면·백엔드·네이버 발행 모듈이 전부 이 파일의 기준을 함께 쓰기 때문에,
 *   어디서 계산하든 결과가 똑같아 시간이 어긋나는 문제가 생기지 않습니다.
 */
const SCHEDULE_MINUTE_STEP = 10; // 예약 가능한 분 단위 (네이버 규칙)
const MIN_SCHEDULE_LEAD_MINUTES = 20; // 지금으로부터 최소 20분 뒤부터 예약 가능
const MAX_SCHEDULE_DAYS = 365; // 최대 1년 뒤까지만 예약 가능

// 입력값(문자열이든 날짜든)을 날짜로 바꾼다. 형식이 잘못됐으면 바로 알려준다.
function parseDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('예약 발행 날짜와 시간을 올바르게 입력해주세요.');
  }
  return date;
}

/**
 * 시각을 다음 10분 단위로 '올림'한다. (14:07 → 14:10, 14:10:30 → 14:20)
 * 초 단위가 남아 있으면 이미 지난 시각으로 간주해 한 칸 더 올린다.
 */
function roundUpToScheduleStep(value) {
  const date = parseDate(value);
  const hadSubMinute = date.getSeconds() !== 0 || date.getMilliseconds() !== 0;
  date.setSeconds(0, 0);
  const remainder = date.getMinutes() % SCHEDULE_MINUTE_STEP;
  if (remainder > 0) {
    date.setMinutes(date.getMinutes() + SCHEDULE_MINUTE_STEP - remainder);
  } else if (hadSubMinute) {
    date.setMinutes(date.getMinutes() + SCHEDULE_MINUTE_STEP);
  }
  return date;
}

/**
 * 사용자가 고른 예약 시각을 검사하고 정리한다.
 * 10분 단위로 맞춘 뒤, 20분 이후 ~ 1년 이내 범위에 있는지 확인한다.
 */
function normalizeScheduleAt(value, nowMs = Date.now()) {
  const date = roundUpToScheduleStep(value);
  const minimum = nowMs + MIN_SCHEDULE_LEAD_MINUTES * 60 * 1000;
  const maximum = nowMs + MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000;

  if (date.getTime() < minimum) {
    throw new Error(`예약 발행 시각은 현재보다 최소 ${MIN_SCHEDULE_LEAD_MINUTES}분 이후로 설정해주세요.`);
  }
  if (date.getTime() > maximum) {
    throw new Error(`예약 발행은 오늘부터 ${MAX_SCHEDULE_DAYS}일 이내로 설정해주세요.`);
  }
  return date.toISOString();
}

/**
 * 여러 글을 한꺼번에 예약할 때, 각 글의 예약 시각을 순서대로 벌려서 만든다.
 * 예) 시작 14:00, 간격 60분 → 1번째 14:00, 2번째 15:00, 3번째 16:00
 * 같은 시각에 여러 글이 몰려 올라가는 것을 막기 위한 계산이다.
 */
function buildBatchScheduleAt(normalizedStart, index, intervalMinutes) {
  const start = parseDate(normalizedStart);
  const safeIndex = Math.max(0, Number.isInteger(index) ? index : 0);
  const safeInterval = Math.max(1, Number(intervalMinutes) || 60);
  const candidate = new Date(start.getTime() + safeIndex * safeInterval * 60 * 1000);
  return roundUpToScheduleStep(candidate).toISOString();
}

/**
 * 예약 시각을 화면 표시용 조각으로 나눈다.
 * 네이버 예약 화면의 달력·시간 선택 칸을 자동으로 채울 때 각 값(년/월/일/시/분)이 필요하고,
 * 사용자에게 보여줄 "2026-08-12 14:10" 같은 문구도 함께 만들어 둔다.
 */
function toLocalScheduleParts(value) {
  const date = parseDate(value);
  const pad = (number) => String(number).padStart(2, '0');
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: pad(date.getHours()),
    minute: pad(date.getMinutes()),
    dateLabel: `${date.getFullYear()}. ${pad(date.getMonth() + 1)}. ${pad(date.getDate())}`,
    display: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

module.exports = {
  MAX_SCHEDULE_DAYS,
  MIN_SCHEDULE_LEAD_MINUTES,
  SCHEDULE_MINUTE_STEP,
  buildBatchScheduleAt,
  normalizeScheduleAt,
  roundUpToScheduleStep,
  toLocalScheduleParts,
};
