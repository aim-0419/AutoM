import { initStyledHistoryView } from '../../shared/views/history.js';

// Creator에서는 하나의 기록 파일을 플랫폼별 탭으로 나눠 보여 준다.
export async function initCreatorHistoryView(container) {
  await initStyledHistoryView(container, { platformTabs: true });
}
