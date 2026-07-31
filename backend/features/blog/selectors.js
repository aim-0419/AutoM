/**
 * 네이버 블로그 스마트에디터 ONE DOM 셀렉터 모음.
 * 확인 날짜: 2026-07-08 (실제 로그인 후 blog.naver.com 글쓰기 페이지에서 직접 확인)
 *
 * 대부분의 클래스명에는 CSS Modules 해시가 붙어 있어(예: publish_btn__m9KHH) 네이버가
 * 프론트엔드를 재배포하면 해시 부분만 바뀌는 경우가 많다. 그래서 의미 있는 접두어만
 * [class*="..."] 부분 일치로 잡아 해시 변경에 어느 정도 내성을 갖게 했다.
 * 네이버 UI 구조 자체가 바뀌면(레이아웃 변경 등) 이 파일을 다시 확인해서 고쳐야 한다.
 */

module.exports = {
  writeUrl: (blogId) => `https://blog.naver.com/${blogId}?Redirect=Write&`,

  // 에디터 본체는 이 URL 조각을 포함한 iframe 안에 있다.
  editorFrameUrlPart: 'PostWriteForm',

  // "작성 중인 글이 있습니다 / 이어서 작성하시겠습니까?" 팝업 - [취소]를 눌러 새 글로 시작한다.
  continueWritingPopup: '.se-popup-alert-confirm',
  continueWritingCancelButton: '.se-popup-button-cancel',

  // 제목 / 본문
  titleArea: '.se-title-text',
  bodyComponent: '.se-component.se-text',

  // 이미지 업로드 (에디터 상단 툴바의 "사진" 버튼)
  imageToolbarButton: '.se-toolbar-item-image [data-name="image"]',

  // 발행 버튼 (우측 상단, 발행 설정 패널을 여는 버튼)
  openPublishPanelButton: '[class*="publish_btn__"]',

  // 발행 설정 패널 내부
  categorySelectButton: '[class*="option_category"] button[class*="selectbox_button"]',
  categoryOptionByName: (name) => `[role="menuitem"]:has-text("${name}"), li:has-text("${name}")`,

  // 실제 input은 opacity:0으로 숨겨져 있어 감싸는 span을 클릭해야 동작한다.
  visibilityRadio: {
    public: 'span:has(#open_public)',
    neighbor: 'span:has(#open_neighbor)',
    bothNeighbor: 'span:has(#open_both_neighbor)',
    private: 'span:has(#open_private)',
  },

  // 발행 시간: 현재 발행 또는 네이버 서버에 예약 등록
  publishTimeRadio: {
    now: 'label[for="radio_time1"]',
    scheduled: 'label[for="radio_time2"]',
  },
  scheduledTimeInput: 'input#radio_time2',
  scheduleDateInput: 'input[class*="input_date"]',
  scheduleHourSelect: 'select[class*="hour_option"]',
  scheduleMinuteSelect: 'select[class*="minute_option"]',
  scheduleCalendar: '.ui-datepicker:visible',
  scheduleCalendarYear: '.ui-datepicker-year',
  scheduleCalendarMonth: '.ui-datepicker-month',
  scheduleCalendarNext: '.ui-datepicker-next:not(.ui-state-disabled)',
  scheduleCalendarDayButtons: 'tbody button.ui-state-default',

  // 같은 영역에 크기가 0인 "fake_input" 요소가 함께 있으므로 반드시 tag_input으로 특정한다.
  tagInput: 'input[class*="tag_input"]',

  // 최종 발행 확정 버튼 (패널 내부 - openPublishPanelButton과는 다른 버튼)
  confirmPublishButton: '[class*="layer_publish"] button[class*="confirm_btn"]',
};
