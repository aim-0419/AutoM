/**
 * [동시 처리 도우미 - 여러 작업을 '정해진 개수만큼만' 한 번에 처리]
 *
 * 비개발자를 위한 설명:
 * - 카드 이미지 10장을 만들 때 하나씩 순서대로 하면 너무 느리고,
 *   10개를 전부 동시에 요청하면 AI 서비스가 "요청이 너무 많다"며 거부합니다.
 * - 그래서 은행 창구처럼 "동시에 3명까지만" 식으로 처리 인원을 정해두고,
 *   한 명이 끝나면 다음 사람이 그 자리에 들어가는 방식으로 처리합니다.
 * - 결과는 끝난 순서가 아니라 '원래 입력한 순서' 그대로 정리해서 돌려줍니다.
 *   (1번 카드가 늦게 끝나도 결과 목록에서는 여전히 1번 자리입니다)
 */
async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length); // 결과를 원래 순서대로 담아둘 자리
  let nextIndex = 0; // 다음에 처리할 작업 번호 (창구 직원들이 공유하는 대기표)

  // '창구 직원' 한 명의 동작: 남은 작업이 있으면 하나 집어 처리하고, 없을 때까지 반복한다.
  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  // 창구 수는 최소 1명, 최대는 '요청한 동시 처리 수'와 '실제 작업 수' 중 작은 쪽이다.
  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

module.exports = { mapWithConcurrency };
