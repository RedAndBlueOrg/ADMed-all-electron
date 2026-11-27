'use strict';

const { app, BrowserWindow } = require('electron');

// 확인 간격 기본 6시간(하루 4회): 재부팅하지 않는 기기도 릴리스 후 6시간 안에 받는다.
// GitHub provider 는 확인 1회에 releases.atom + latest.yml 2건만 받으므로 한 현장(같은 공인 IP)에 기기가 여러 대여도 부담이 없다.
const DEFAULT_CHECK_INTERVAL_HOURS = 6;
const MIN_CHECK_INTERVAL_HOURS = 1;
// 최대 1주: setInterval 은 2^31-1ms(약 596시간)를 넘으면 1ms 로 바뀌어 쉬지 않고 확인한다.
const MAX_CHECK_INTERVAL_HOURS = 24 * 7;
// 운영 중에 받은 업데이트는 이 시각(로컬, 기본 03시 — 일반기관 운영시간 밖)까지 미뤄 설치한다. 그 전에 앱이 끝나면 autoInstallOnAppQuit 가 설치한다.
const DEFAULT_INSTALL_HOUR = 3;
// 시작 후 이 안에 다운로드가 끝나면 바로 설치한다. 재생이 막 시작된 때라 영향이 작고,
// 전원을 내려 끄는 기기(종료 이벤트 없음·03시에 꺼져 있음)는 낮에 받아 둔 업데이트를 다음 부팅의 이 경로로만 설치한다.
// 부팅 직후엔 네트워크가 늦게 붙기도 하므로 이 안에서 실패하면 1분마다 다시 확인한다.
const STARTUP_INSTALL_GRACE_MS = 5 * 60 * 1000;
const STARTUP_RETRY_MS = 60 * 1000;

const toNumber = (v) => (v == null || String(v).trim() === '' ? NaN : Number(v));

function readUpdateSchedule(env = process.env) {
  const hours = toNumber(env.UPDATE_CHECK_INTERVAL_HOURS);
  const hour = toNumber(env.UPDATE_INSTALL_HOUR);
  return {
    intervalMs: (hours > 0 ? Math.min(Math.max(hours, MIN_CHECK_INTERVAL_HOURS), MAX_CHECK_INTERVAL_HOURS) : DEFAULT_CHECK_INTERVAL_HOURS) * 3600 * 1000,
    installHour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_INSTALL_HOUR,
  };
}

function msUntilHour(nowMs, hour) {
  const next = new Date(nowMs);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= nowMs) next.setDate(next.getDate() + 1);
  return next.getTime() - nowMs;
}

// updater 는 checkForUpdates()/quitAndInstall() 만 쓴다(테스트에서 가짜로 바꿀 수 있게).
// 확인·다운로드 실패는 로그만 남기고 다시 시도한다(유예 안 1분, 그 밖은 다음 주기) — 재생 쪽으로 던지지 않는다.
// 유예는 단조 시계(uptime)로 잰다 — 부팅 직후 NTP 가 벽시계를 옮겨도 흔들리지 않게. 벽시계(now)는 설치 시각 판정에만 쓴다.
function startUpdateSchedule(updater, { intervalMs, installHour, now = Date.now, uptime = () => performance.now(), log = console }) {
  const startedAt = uptime();
  const inStartupGrace = () => uptime() - startedAt <= STARTUP_INSTALL_GRACE_MS;
  let installTimer = null;
  let retryTimer = null;
  let inflight = null;
  let stopped = false;

  const install = () => {
    try {
      updater.quitAndInstall(false, true);
    } catch (err) {
      log.warn('[update] quitAndInstall failed:', err?.message || err);
    }
  };

  // 설치 시각(installHour 시대)이면 바로 설치, 아니면 그 시각까지 예약. 타이머가 울릴 때 시각을 다시 보므로
  // 시계 보정·절전으로 어긋나 운영 시간에 울려도 설치하지 않고 다시 예약한다.
  const installInWindow = () => {
    installTimer = null;
    if (new Date(now()).getHours() === installHour) {
      log.log(`[update] in install hour ${installHour}:00 - installing now`);
      install(); // 설치를 못 하면 다음 주기 확인이 캐시된 파일로 다시 예약한다
      return;
    }
    const delay = msUntilHour(now(), installHour);
    log.log(`[update] install at ${installHour}:00 (in ${Math.round(delay / 60000)} min) or on quit`);
    installTimer = setTimeout(installInWindow, delay);
  };

  const run = async () => {
    try {
      const result = await updater.checkForUpdates();
      if (!result?.downloadPromise) return;
      await result.downloadPromise;
    } catch (err) {
      const retry = !stopped && inStartupGrace() && !retryTimer;
      log.warn(`[update] check/download failed (retry ${retry ? 'in 1 min' : 'next interval'}):`, err?.message || err);
      if (retry) retryTimer = setTimeout(() => { retryTimer = null; check(); }, STARTUP_RETRY_MS);
      return;
    }
    if (stopped) return;
    if (inStartupGrace()) {
      log.log('[update] downloaded right after startup - installing now');
      install();
      return;
    }
    if (!installTimer) installInWindow();
  };
  // 한 번에 하나만 돈다. 다운로드가 간격보다 길면 electron-updater 는 같은 downloadPromise 를 돌려주는데,
  // 두 check 가 함께 깨어나 quitAndInstall 을 두 번 부르면 두 번째가 quitAndInstallCalled 를 되돌려 종료 때 installer 가 또 뜬다.
  // electron-updater 가 멈추면(응답 없는 프록시 등) 재시작 전까지 여기서 계속 합쳐진다 — 로그로 구분되게 남긴다.
  const check = () => {
    if (inflight) {
      log.log('[update] previous check still running');
      return inflight;
    }
    return (inflight = run().finally(() => { inflight = null; }));
  };

  check();
  const checkTimer = setInterval(check, intervalMs);
  return {
    stop() {
      stopped = true;
      clearInterval(checkTimer);
      clearTimeout(installTimer);
      clearTimeout(retryTimer);
    },
  };
}

function initAutoUpdater() {
  if (!app.isPackaged) return;
  const { autoUpdater } = require('electron-updater');
  try {
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (token) {
      autoUpdater.requestHeaders = { Authorization: `token ${token}` };
    }
    const broadcastUpdateEvent = (channel, payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(channel, payload);
      }
    };
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', (err) => {
      console.warn('[update] error:', err?.message || err);
      broadcastUpdateEvent('update:error', err?.message || String(err));
    });
    autoUpdater.on('update-available', (info) => {
      console.log('[update] available:', info?.version || 'unknown');
      broadcastUpdateEvent('update:available', info);
    });
    autoUpdater.on('update-downloaded', (info) => {
      console.log('[update] downloaded:', info?.version || 'unknown');
      broadcastUpdateEvent('update:ready', info);
    });
    autoUpdater.on('download-progress', (progress) => {
      broadcastUpdateEvent('update:progress', progress);
    });
    // checkForUpdatesAndNotify 는 받은 뒤 OS 알림을 띄운다 — 주기 확인이면 사이니지 화면에 알림이 뜨므로 checkForUpdates 를 쓴다.
    startUpdateSchedule(autoUpdater, readUpdateSchedule());
  } catch (err) {
    console.warn('[update] init failed:', err?.message || err);
  }
}

module.exports = {
  initAutoUpdater,
  readUpdateSchedule,
  msUntilHour,
  startUpdateSchedule,
  STARTUP_INSTALL_GRACE_MS,
};
