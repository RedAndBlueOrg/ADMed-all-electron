const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readUpdateSchedule, msUntilHour, startUpdateSchedule, STARTUP_INSTALL_GRACE_MS } = require('../src/main/updater');

const HOUR = 3600 * 1000;
const flush = () => new Promise((resolve) => setImmediate(resolve));

// 확인 1회마다 steps 에서 하나씩 꺼내 응답한다. 다 쓰면 '업데이트 없음'.
function fakeUpdater(steps) {
  const calls = { check: 0, install: [], warn: [] };
  const updater = {
    async checkForUpdates() {
      const step = steps[calls.check++] || 'none';
      if (step === 'fail') throw new Error('net::ERR_INTERNET_DISCONNECTED');
      if (step === 'none') return { isUpdateAvailable: false };
      if (step === 'download-fail') return { isUpdateAvailable: true, downloadPromise: Promise.reject(new Error('sha512 checksum mismatch')) };
      if (step === 'slow') return { isUpdateAvailable: true, downloadPromise: new Promise((r) => setTimeout(r, STARTUP_INSTALL_GRACE_MS + 60 * 1000)) };
      return { isUpdateAvailable: true, downloadPromise: Promise.resolve(['ADMed-All-1.0.1-Setup.exe']) };
    },
    quitAndInstall(...args) {
      calls.install.push({ args, at: new Date(Date.now()) });
      if (updater.installThrows) throw new Error('installer locked');
    },
  };
  const log = { log() {}, warn: (...a) => calls.warn.push(a.join(' ')) };
  return { updater, calls, log };
}

function start(t, steps, startAt = new Date(2026, 10, 27, 10, 0, 0)) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: startAt });
  const fake = fakeUpdater(steps);
  const schedule = startUpdateSchedule(fake.updater, { intervalMs: 6 * HOUR, installHour: 3, log: fake.log });
  t.after(() => schedule.stop());
  return fake;
}

async function advance(t, ms) {
  t.mock.timers.tick(ms);
  await flush();
}

test('간격·설치 시각 설정: 기본 6시간·03시, 1시간 미만은 1시간, 잘못된 값은 기본값', () => {
  assert.deepEqual(readUpdateSchedule({}), { intervalMs: 6 * HOUR, installHour: 3 });
  assert.deepEqual(readUpdateSchedule({ UPDATE_CHECK_INTERVAL_HOURS: '12', UPDATE_INSTALL_HOUR: '0' }), { intervalMs: 12 * HOUR, installHour: 0 });
  assert.deepEqual(readUpdateSchedule({ UPDATE_CHECK_INTERVAL_HOURS: '0.25', UPDATE_INSTALL_HOUR: '23' }), { intervalMs: 1 * HOUR, installHour: 23 });
  for (const [h, i] of [['', ''], ['abc', '24'], ['0', '-1'], ['-3', '3.5']]) {
    assert.deepEqual(readUpdateSchedule({ UPDATE_CHECK_INTERVAL_HOURS: h, UPDATE_INSTALL_HOUR: i }), { intervalMs: 6 * HOUR, installHour: 3 }, `${h}/${i}`);
  }
});

test('설치 시각까지 남은 시간: 그 시각이 지났거나 정각이면 다음 날', () => {
  assert.equal(msUntilHour(new Date(2026, 10, 27, 2, 0).getTime(), 3), 1 * HOUR);
  assert.equal(msUntilHour(new Date(2026, 10, 27, 3, 0).getTime(), 3), 24 * HOUR);
  assert.equal(msUntilHour(new Date(2026, 10, 27, 16, 30).getTime(), 3), 10.5 * HOUR);
});

test('시작하자마자 확인하고, 이후 간격마다 다시 확인한다', async (t) => {
  const { calls } = start(t, []);
  await flush();
  assert.equal(calls.check, 1);
  await advance(t, 6 * HOUR - 1);
  assert.equal(calls.check, 1);
  await advance(t, 1);
  assert.equal(calls.check, 2);
  await advance(t, 18 * HOUR);
  assert.equal(calls.check, 5);
  assert.equal(calls.install.length, 0);
});

test('시작 직후 받은 업데이트는 바로 설치한다(quitAndInstall(false, true))', async (t) => {
  const { calls } = start(t, ['update']);
  await flush();
  assert.equal(calls.install.length, 1);
  assert.deepEqual(calls.install[0].args, [false, true]);
});

test('운영 중 받은 업데이트는 재생 중 재시작하지 않고 03시에 한 번만 설치한다', async (t) => {
  const { calls } = start(t, ['none', 'update', 'update']); // 10시 없음 → 16시·22시 받음
  await flush();
  await advance(t, 6 * HOUR); // 16:00
  assert.equal(calls.check, 2);
  assert.equal(calls.install.length, 0);
  await advance(t, 6 * HOUR); // 22:00 — 다시 받아도 예약은 하나
  await advance(t, 5 * HOUR - 1); // 02:59:59.999
  assert.equal(calls.install.length, 0);
  await advance(t, 1);
  assert.equal(calls.install.length, 1);
  const at = calls.install[0].at;
  assert.deepEqual([at.getDate(), at.getHours(), at.getMinutes()], [28, 3, 0]);
  await advance(t, 24 * HOUR);
  assert.equal(calls.install.length, 1);
});

test('시작 확인이라도 다운로드가 유예(5분)를 넘기면 03시로 미룬다', async (t) => {
  const { calls } = start(t, ['slow']);
  await advance(t, STARTUP_INSTALL_GRACE_MS + 60 * 1000);
  assert.equal(calls.install.length, 0);
  await advance(t, 17 * HOUR - STARTUP_INSTALL_GRACE_MS - 60 * 1000); // 다음 날 03:00
  assert.equal(calls.install.length, 1);
});

test('확인·다운로드 실패는 로그만 남기고 다음 간격에 다시 확인한다', async (t) => {
  const unhandled = [];
  const onUnhandled = (err) => unhandled.push(err);
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.off('unhandledRejection', onUnhandled));

  const { calls } = start(t, ['fail', 'download-fail', 'none']);
  await flush();
  await advance(t, 6 * HOUR);
  await advance(t, 6 * HOUR);
  assert.equal(calls.check, 3);
  assert.equal(calls.install.length, 0);
  assert.equal(calls.warn.length, 2);
  assert.match(calls.warn[0], /ERR_INTERNET_DISCONNECTED/);
  assert.match(calls.warn[1], /sha512/);
  assert.deepEqual(unhandled, []);
});

test('03시 설치가 실패하면 로그를 남기고, 다음 확인이 다음 날 03시로 다시 예약한다', async (t) => {
  const { updater, calls } = start(t, ['none', 'update', 'none', 'update']); // 10·16·22·04시
  updater.installThrows = true;
  await flush();
  await advance(t, 6 * HOUR); // 16:00 받음 → 03:00 예약
  await advance(t, 11 * HOUR); // 다음 날 03:00 설치 시도 → 실패
  assert.equal(calls.install.length, 1);
  assert.match(calls.warn.at(-1), /installer locked/);
  updater.installThrows = false;
  await advance(t, 1 * HOUR); // 04:00 확인에서 다시 받음 → 다음 날 03:00 예약
  await advance(t, 23 * HOUR);
  assert.equal(calls.install.length, 2);
  assert.deepEqual([calls.install[1].at.getDate(), calls.install[1].at.getHours()], [29, 3]);
});
