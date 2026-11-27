const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// B 모드 오른쪽 패널의 날짜·시계는 날씨 조회와 별개다. 날씨 키가 없거나 조회가 실패해도
// 사이클마다 부르는 updateWeatherPanel() 직후에 날짜·시계가 보여야 한다.
const els = {};
const el = () => ({ style: {}, innerHTML: '', textContent: '' });
let state, updateWeatherPanel;

before(async () => {
  for (const id of ['weather-panel', 'weather-title', 'weather-meta', 'weather-content']) els[id] = el();
  globalThis.document = { getElementById: (id) => els[id] || null, querySelector: () => null };
  // 키 없음(일반기관 .env 에서 WEATHER_SERVICE_KEY 를 비운 경우)
  globalThis.window = { mediaAPI: { getWeatherConfig: async () => ({ lat: 37.5, lon: 127, weatherServiceKey: '' }) } };
  ({ default: state } = await import('../src/renderer/state.js'));
  ({ updateWeatherPanel } = await import('../src/renderer/weather.js'));
});
after(() => {
  delete globalThis.document;
  delete globalThis.window;
});

test('B 모드: 날씨 키가 없어도 패널을 다시 그린 직후 날짜·시계가 보인다', async () => {
  state.waitingInfo = 'B';
  updateWeatherPanel();
  await new Promise((r) => setTimeout(r, 0)); // getWeatherConfig → fetchWeather(키 없음) 까지 진행
  assert.equal(els['weather-panel'].style.display, 'flex');
  assert.match(els['weather-title'].innerHTML, /\d+월 \d+일.*<span class="weekday">.+요일<\/span>/);
  assert.match(els['weather-meta'].innerHTML, /<span class="ampm">오[전후]<\/span>\d{1,2}:\d{2}/);
});

test('B 가 아니면 날씨 패널을 숨긴다', () => {
  state.waitingInfo = 'A';
  updateWeatherPanel();
  assert.equal(els['weather-panel'].style.display, 'none');
});
