'use strict';

const { app, BrowserWindow } = require('electron');

// 확인 간격 기본 6시간(하루 4회): 재부팅하지 않는 기기도 릴리스 후 6시간 안에 받는다.
// GitHub provider 는 확인 1회에 releases.atom + latest.yml 2건만 받으므로 한 현장(같은 공인 IP)에 기기가 여러 대여도 부담이 없다.
const DEFAULT_CHECK_INTERVAL_HOURS = 6;
const MIN_CHECK_INTERVAL_HOURS = 1;
// 운영 중에 받은 업데이트는 이 시각(로컬, 기본 03시 — 일반기관 운영시간 밖)까지 미뤄 설치한다. 그 전에 앱이 끝나면 autoInstallOnAppQuit 가 설치한다.
const DEFAULT_INSTALL_HOUR = 3;
// 시작 후 이 안에 다운로드가 끝나면 바로 설치한다. 재생이 막 시작된 때라 영향이 작고,
// 전원을 내려 끄는 기기(종료 이벤트 없음·03시에 꺼져 있음)는 낮에 받아 둔 업데이트를 다음 부팅의 이 경로로만 설치한다.
const STARTUP_INSTALL_GRACE_MS = 5 * 60 * 1000;

const toNumber = (v) => (v == null || String(v).trim() === '' ? NaN : Number(v));

function readUpdateSchedule(env = process.env) {
  const hours = toNumber(env.UPDATE_CHECK_INTERVAL_HOURS);
  const hour = toNumber(env.UPDATE_INSTALL_HOUR);
  return {
    intervalMs: (hours > 0 ? Math.max(hours, MIN_CHECK_INTERVAL_HOURS) : DEFAULT_CHECK_INTERVAL_HOURS) * 3600 * 1000,
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
// 확인·다운로드 실패는 로그만 남기고 다음 주기에 다시 시도한다 — 재생 쪽으로 던지지 않는다.
function startUpdateSchedule(updater, { intervalMs, installHour, now = Date.now, log = console }) {
  const startedAt = now();
  let installTimer = null;

  const install = () => {
    try {
      updater.quitAndInstall(false, true);
    } catch (err) {
      log.warn('[update] quitAndInstall failed:', err?.message || err);
    }
  };

  const check = async () => {
    try {
      const result = await updater.checkForUpdates();
      if (!result?.downloadPromise) return;
      await result.downloadPromise;
    } catch (err) {
      log.warn('[update] check/download failed (retry next interval):', err?.message || err);
      return;
    }
    if (now() - startedAt <= STARTUP_INSTALL_GRACE_MS) {
      log.log('[update] downloaded right after startup - installing now');
      install();
      return;
    }
    if (installTimer) return;
    const delay = msUntilHour(now(), installHour);
    log.log(`[update] downloaded - install at ${installHour}:00 (in ${Math.round(delay / 60000)} min) or on quit`);
    installTimer = setTimeout(() => {
      installTimer = null;
      install(); // 실패하면 다음 주기 확인이 캐시된 파일로 다시 예약한다
    }, delay);
  };

  check();
  const checkTimer = setInterval(check, intervalMs);
  return {
    stop() {
      clearInterval(checkTimer);
      clearTimeout(installTimer);
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
