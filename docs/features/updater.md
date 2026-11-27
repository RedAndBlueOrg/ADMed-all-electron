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
   - 유예 안에서 확인·다운로드가 실패하면 1분(`STARTUP_RETRY_MS`)마다 다시 확인 — 부팅 직후 네트워크가 늦게 붙는 경우. 유예 밖 실패는 다음 주기
   - 그 뒤에 끝나면 **`UPDATE_INSTALL_HOUR` 시대**(로컬, 기본 03:00~03:59)에 설치. 지금이 그 시대면 바로, 아니면 다음 정각까지 `setTimeout` 1개만 예약. 타이머가 울릴 때 시각을 다시 보고, 시계 보정·절전으로 어긋나 다른 시각이면 다시 예약한다. 그 전에 앱이 정상 종료되면 `autoInstallOnAppQuit` 가 설치
   - 유예 판정은 벽시계 경과로 잰다. 시계가 뒤로 보정돼 경과가 음수면 유예로 치지 않는다(즉시 설치 대신 03시)
   - `checkForUpdatesAndNotify` 대신 `checkForUpdates` — 전자는 받은 뒤 OS 알림을 띄워 사이니지 화면에 보인다

## 시점 근거
- **간격 6시간**: 재부팅하지 않는 기기도 릴리스 후 6시간 안에 받는다. GitHub provider 는 확인 1회에 `releases.atom` + `latest.yml` 2건이라 한 현장(같은 공인 IP)에 기기가 여러 대여도 부담이 없다. 1시간 미만 값은 1시간으로 올린다.
- **설치 03시**: 일반기관 운영시간 밖. 운영 중 재생을 끊고 재시작하지 않는다.
- **시작 직후 5분 즉시 설치**: 재생이 막 시작된 때라 재시작 영향이 작다. 그리고 전원을 내려 끄는 기기(종료 이벤트 없음·03시에 꺼져 있음)는 낮에 받아 둔 업데이트를 다음 부팅의 이 경로로만 설치한다 — 캐시에 있는 파일이라 부팅 직후 바로 끝난다. 부팅 때 처음 받는 다운로드가 5분을 넘기면 03시로 미룬다.
- **트레이드오프**: 운영 시간 중 앱이 다시 뜨면(관리자 재부팅, Windows Update 재부팅, 크래시 후 재실행) 캐시된 업데이트가 이 경로로 바로 설치돼 몇 분 사이 재시작이 한 번 더 일어난다. 끄는 기기가 업데이트를 받는 유일한 경로라 받아들인다.
- **간격 최대 1주**: `setInterval` 은 2^31-1ms(약 596시간)를 넘으면 1ms 로 바뀌어 쉬지 않고 확인한다. `.env` 는 CI secret 으로 전 기기에 같이 배포되므로 오타 하나가 전 기기에 퍼진다. 최소 1시간은 유예(5분)보다 길어야 유예 안에서 두 확인이 겹쳐 설치를 두 번 부르지 않는다.

## 설정 (`.env`, 선택)
| 이름 | 기본 | 범위 |
|---|---|---|
| `UPDATE_CHECK_INTERVAL_HOURS` | 6 | 양수, 1 미만은 1, 168(1주) 초과는 168. 그 밖의 값은 기본값 |
| `UPDATE_INSTALL_HOUR` | 3 | 0~23 정수. 그 밖의 값은 기본값 |

## 콘텐츠 동기화 경합 (현재 정책: 설치 시점이면 설치)
- `src/main/playlist.js` `preparePlaylist()` 시작 시 `state.contentSyncing = true`, 끝/에러 시 `false`
- updater 는 `contentSyncing` 을 **보지 않는다** — 설치 시점(시작 직후 또는 03시)이 오면 설치하고, 재시작 후 동기화가 다시 돈다
- "동기화 끝날 때까지 대기" 로 바꾸려면: `startUpdateSchedule()` 의 `install()` 에서 `contentSyncing` 확인 → true 면 미뤘다가 설치. → [../development/impact-map.md](../development/impact-map.md) "자동 업데이트 ↔ 콘텐츠 동기화"

## 환경변수
`GH_TOKEN` / `GITHUB_TOKEN` (비공개 릴리스 다운로드 인증 — 공개 릴리스면 불필요), 위 설정 2개.

## 엣지 / 실패
- 네트워크 단절·서버 503·`latest.yml` 404·다운로드 해시 불일치 → `electron-updater` 의 `error` 이벤트 로그 + `[update] check/download failed (retry next interval)` 경고만. 재생 쪽으로 던지지 않고 다시 확인(유예 안 1분, 그 밖 다음 주기)
- 03시 `quitAndInstall` 동기 실패(설치 파일 없음 등) → electron-updater 가 안에서 잡아 `error` 이벤트 로그만 남기고 앱은 그대로 재생. 다음 주기 확인이 캐시된 파일로 다시 예약
- **미해결(이전부터)**: `NsisUpdater.doInstall` 은 installer 를 비동기 spawn 하고 바로 true 를 돌려줘 앱이 먼저 종료된다. 백신 차단 등으로 installer 실행이 실패하면 앱이 꺼진 채 남는다 — 이제 03시 무인 시간대에 일어나므로 아침까지 화면이 꺼져 있을 수 있다. 감시(작업 스케줄러 등)는 별도 과제
- 03시 예약 뒤 다음 주기 확인에서 다시 받아도 예약은 하나. 새 버전 다운로드가 실패하면 electron-updater 가 받아 둔 파일을 지워 03시 설치가 `error` 로 끝나고, 다음 확인에서 다시 받아 다음 날 설치한다(하루 지연)
- 버전 비교는 `package.json` 의 `version` — bump 안 하면 업데이트 안 잡힘

## 관련 사고
(없음)
