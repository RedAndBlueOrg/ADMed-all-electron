# 자동 업데이트 — electron-updater + GitHub Releases

> 이 문서는 자동 업데이트 동작, 콘텐츠 동기화 경합, 업데이트 이벤트 처리 구현·변경·디버깅 시 본다. 빌드/배포 쪽은 [../development/build-deploy.md](../development/build-deploy.md).

## 한 줄 정의
패키지 모드(`app.isPackaged`)에서만 `electron-updater` 가 GitHub Releases(`RedAndBlueOrg/ADMed-all-electron`)의 latest 와 `package.json` 버전을 비교 → 시작할 때와 그 뒤 주기마다 확인·자동 다운로드 → 시작 직후 받은 것은 바로, 운영 중 받은 것은 새벽 설치 시각(또는 그 전 앱 종료 때) 설치.

## 모듈
main: `src/main/updater.js` `initAutoUpdater()` — `main.js` 의 `whenReady` 에서 호출. `electron-updater` 는 함수 내부 lazy `require`. 확인·설치 시점은 `startUpdateSchedule(updater, { intervalMs, installHour })` 이 맡는다(electron 없이 테스트: `test/updater.test.js`).

## 동작 (`initAutoUpdater()`)
1. `if (!app.isPackaged) return;` — 개발 모드는 아무것도 안 함
2. `GH_TOKEN`/`GITHUB_TOKEN` 있으면 `autoUpdater.requestHeaders = { Authorization: 'token <...>' }` (비공개 릴리스)
3. `autoDownload = true`, `autoInstallOnAppQuit = true`
4. 이벤트 → renderer 로 broadcast (`update:error`/`update:available`/`update:ready`/`update:progress`) — **단 preload 가 이 채널들을 노출 안 함 → renderer 가 못 받음** (진행률 UI 가 필요하면 preload 브리지 추가 필요)
5. `startUpdateSchedule()` — 시작 즉시 1회 + `setInterval` 로 주기마다 `checkForUpdates()` → 결과의 `downloadPromise` 를 기다린다.
   - 시작 후 **5분**(`STARTUP_INSTALL_GRACE_MS`) 안에 다운로드가 끝나면 바로 `quitAndInstall(false, true)` (`isSilent=false`, `isForceRunAfter=true`)
   - 그 뒤에 끝나면 다음 **`UPDATE_INSTALL_HOUR` 정각**(로컬, 기본 03시)에 설치하도록 `setTimeout` 1개만 예약. 그 전에 앱이 정상 종료되면 `autoInstallOnAppQuit` 가 설치
   - `checkForUpdatesAndNotify` 대신 `checkForUpdates` — 전자는 받은 뒤 OS 알림을 띄워 사이니지 화면에 보인다

## 시점 근거
- **간격 6시간**: 재부팅하지 않는 기기도 릴리스 후 6시간 안에 받는다. GitHub provider 는 확인 1회에 `releases.atom` + `latest.yml` 2건이라 한 현장(같은 공인 IP)에 기기가 여러 대여도 부담이 없다. 1시간 미만 값은 1시간으로 올린다.
- **설치 03시**: 일반기관 운영시간 밖. 운영 중 재생을 끊고 재시작하지 않는다.
- **시작 직후 5분 즉시 설치**: 재생이 막 시작된 때라 재시작 영향이 작다. 그리고 전원을 내려 끄는 기기(종료 이벤트 없음·03시에 꺼져 있음)는 낮에 받아 둔 업데이트를 다음 부팅의 이 경로로만 설치한다 — 캐시에 있는 파일이라 부팅 직후 바로 끝난다. 부팅 때 처음 받는 다운로드가 5분을 넘기면 03시로 미룬다.

## 설정 (`.env`, 선택)
| 이름 | 기본 | 범위 |
|---|---|---|
| `UPDATE_CHECK_INTERVAL_HOURS` | 6 | 양수, 1 미만은 1. 그 밖의 값은 기본값 |
| `UPDATE_INSTALL_HOUR` | 3 | 0~23 정수. 그 밖의 값은 기본값 |

## 콘텐츠 동기화 경합 (현재 정책: 설치 시점이면 설치)
- `src/main/playlist.js` `preparePlaylist()` 시작 시 `state.contentSyncing = true`, 끝/에러 시 `false`
- updater 는 `contentSyncing` 을 **보지 않는다** — 설치 시점(시작 직후 또는 03시)이 오면 설치하고, 재시작 후 동기화가 다시 돈다
- "동기화 끝날 때까지 대기" 로 바꾸려면: `startUpdateSchedule()` 의 `install()` 에서 `contentSyncing` 확인 → true 면 미뤘다가 설치. → [../development/impact-map.md](../development/impact-map.md) "자동 업데이트 ↔ 콘텐츠 동기화"

## 환경변수
`GH_TOKEN` / `GITHUB_TOKEN` (비공개 릴리스 다운로드 인증 — 공개 릴리스면 불필요), 위 설정 2개.

## 엣지 / 실패
- 네트워크 단절·서버 503·`latest.yml` 404·다운로드 해시 불일치 → `electron-updater` 의 `error` 이벤트 로그 + `[update] check/download failed (retry next interval)` 경고만. 재생 쪽으로 던지지 않고 다음 주기에 다시 확인
- 03시 `quitAndInstall` 실패(던짐 또는 설치 안 됨) → 경고만. 다음 주기 확인이 캐시된 파일로 다음 날 03시를 다시 예약
- 03시 예약 뒤 다음 주기 확인에서 다시 받아도 예약은 하나 — 03시에는 마지막으로 받은 파일이 설치된다
- 버전 비교는 `package.json` 의 `version` — bump 안 하면 업데이트 안 잡힘

## 관련 사고
(없음)
