// R3: 재생목록 한 사이클이 공지 한 바퀴보다 짧아도 공지가 모두 순서대로 돈다.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const style = () => ({ setProperty() {}, removeProperty() {} });
const span = { style: style(), textContent: '', offsetWidth: 500 };
const noticeText = { style: style(), querySelector: () => span, offsetWidth: 0, onanimationend: null };
const noticeBar = { style: style(), clientWidth: 1709 };
const videoEl = { style: {}, pause() {}, removeAttribute() {}, load() {}, addEventListener() {} };
const imageEl = { style: {}, src: '' };
const frames = [];
let state, initialState, loadPlaylist;

before(async () => {
  globalThis.document = {
    getElementById: (id) => ({ 'notice-bar': noticeBar, 'notice-text': noticeText, video: videoEl, image: imageEl })[id] || null,
    querySelector: () => null,
    documentElement: { style: style() },
  };
  globalThis.window = { mediaAPI: {}, clinicWS: { start() {}, stop() {} }, addEventListener() {}, innerWidth: 1920 };
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);
  ({ default: state } = await import('../src/renderer/state.js'));
  ({ loadPlaylist } = await import('../src/renderer/playlist.js'));
  initialState = { ...state }; // playlist.js 가 등록한 onPlayNext 까지 담는다
});
beforeEach(() => {
  Object.assign(state, initialState, { onPlayNext: () => {} }); // 이미지 타이머가 사이클을 스스로 돌리지 않게
  frames.length = 0;
  noticeText.onanimationend = null;
});
after(() => {
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.requestAnimationFrame;
});

const notices = (names) => names.map((content, sort) => ({ content, sort }));
const response = (noticeList) => ({
  deviceSerial: 'TEST', waitingInfo: 'A', noticeList,
  playlist: [{ type: 'image', localFile: 'a.png', durationSeconds: 0.001 }],
});
// 대기 중인 rAF 를 돌려 화면에 올라간 공지 글자를 돌려준다.
const shown = () => { while (frames.length) frames.shift()(); return span.textContent; };
const finishNotice = () => noticeText.onanimationend();

test('R3 공지 5개, 사이클마다 공지 2개만 지나가도 5개 모두 순서대로 돈다', async () => {
  const list = notices(['공지1', '공지2', '공지3', '공지4', '공지5']);
  window.mediaAPI.preparePlaylist = async () => response(list);
  const seen = [];
  for (let cycle = 0; cycle < 4; cycle += 1) {
    await loadPlaylist({ fromCycle: true });
    seen.push(shown());
    finishNotice();
    seen.push(shown());
    finishNotice();
  }
  assert.deepEqual(seen, ['공지1', '공지2', '공지3', '공지4', '공지5', '공지1', '공지2', '공지3']);
});

test('R3 공지 목록이 그대로면 사이클 재조회가 지나가는 중인 공지를 처음부터 다시 시작하지 않는다', async () => {
  window.mediaAPI.preparePlaylist = async () => response(notices(['가', '나']));
  await loadPlaylist({ fromCycle: true });
  assert.equal(shown(), '가');
  await loadPlaylist({ fromCycle: true });
  assert.equal(frames.length, 0);
});

test('R3 공지 목록이 줄어 순번이 범위를 넘으면 처음부터, 범위 안이면 그 순번부터 돈다', async () => {
  window.mediaAPI.preparePlaylist = async () => response(notices(['1', '2', '3', '4', '5']));
  await loadPlaylist({ fromCycle: true });
  for (let i = 0; i < 4; i += 1) { shown(); finishNotice(); }
  assert.equal(shown(), '5');

  window.mediaAPI.preparePlaylist = async () => response(notices(['A', 'B']));
  await loadPlaylist({ fromCycle: true });
  assert.equal(shown(), 'A');
  finishNotice();
  assert.equal(shown(), 'B');

  window.mediaAPI.preparePlaylist = async () => response(notices(['A', 'B', 'C']));
  await loadPlaylist({ fromCycle: true });
  assert.equal(shown(), 'B');
  finishNotice();
  assert.equal(shown(), 'C');
});

test('R3 모드 N 으로 숨겼다가 다시 켜면 같은 목록이라도 공지를 다시 시작한다', async () => {
  const list = notices(['가', '나']);
  window.mediaAPI.preparePlaylist = async () => response(list);
  await loadPlaylist({ fromCycle: true });
  assert.equal(shown(), '가');
  window.mediaAPI.preparePlaylist = async () => ({ ...response(list), waitingInfo: 'N' });
  await loadPlaylist({ fromCycle: true });
  window.mediaAPI.preparePlaylist = async () => response(list);
  await loadPlaylist({ fromCycle: true });
  assert.equal(frames.length, 1);
});

test('재생목록 1개짜리는 항목이 끝날 때마다 시나리오를 다시 받는다', async () => {
  let calls = 0;
  let resolveThird;
  const third = new Promise((resolve) => { resolveThird = resolve; });
  window.mediaAPI.preparePlaylist = async () => {
    calls += 1;
    if (calls >= 3) { resolveThird(); return {}; } // 시리얼 없는 응답 → 재생 루프를 멈춘다
    return response(notices(['가']));
  };
  state.onPlayNext = initialState.onPlayNext; // 실제 playNext 로 사이클을 돌린다
  await loadPlaylist({ fromCycle: true });
  await third;
  assert.equal(calls, 3);
});
