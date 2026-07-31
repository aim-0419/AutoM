/**
 * 여러 비동기 작업을 정해진 개수만 동시에 실행한다.
 * 결과 배열은 작업이 끝난 순서가 아니라 처음 입력된 순서를 그대로 유지한다.
 */
async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

module.exports = { mapWithConcurrency };
