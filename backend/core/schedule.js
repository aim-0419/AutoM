/**
 * 네이버 예약발행 시각을 검사하고 10분 단위로 맞추는 공통 모듈이다.
 * 화면, 메인 프로세스, 네이버 발행기가 같은 기준을 사용하도록 날짜 계산을 한곳에 둔다.
 */
const SCHEDULE_MINUTE_STEP = 10;
const MIN_SCHEDULE_LEAD_MINUTES = 20;
const MAX_SCHEDULE_DAYS = 365;

function parseDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('예약 발행 날짜와 시간을 올바르게 입력해주세요.');
  }
  return date;
}

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

function buildBatchScheduleAt(normalizedStart, index, intervalMinutes) {
  const start = parseDate(normalizedStart);
  const safeIndex = Math.max(0, Number.isInteger(index) ? index : 0);
  const safeInterval = Math.max(1, Number(intervalMinutes) || 60);
  const candidate = new Date(start.getTime() + safeIndex * safeInterval * 60 * 1000);
  return roundUpToScheduleStep(candidate).toISOString();
}

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
