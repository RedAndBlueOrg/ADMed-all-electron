ADMed All (일반기관 Windows Electron)
=====================================

개요
----
- **일반기관(admed.co.kr)** 용 디지털 사이니지 플레이어입니다. 시나리오 API가 내려주는 재생 목록(이미지/동영상/HLS)을 로컬 캐시로 재생하고 공지·날씨를 표시합니다.
- **의료기관(admed.kr) 앱은 별도 저장소 [RedAndBlueOrg/ADMed-2-electron](https://github.com/RedAndBlueOrg/ADMed-2-electron)** 입니다. 이 저장소는 그 코드에서 갈라져 나왔고(이력 공유), 일반기관 전용으로 정리했습니다. 의료 전용 화면(진료 대기현황·호출 팝업)은 띄우지 않습니다 — 시나리오가 `waitingInfo=Y` 를 보내도 `N`(광고만)으로 처리합니다.
- **버전은 의료기관 앱과 따로 갑니다.** 이 앱은 `1.0.0` 에서 시작하고 첫 릴리스 태그는 `v1.0.0` 입니다. 의료기관 앱의 버전·태그·릴리스와 관계없습니다.

두 앱을 한 PC 에 같이 설치해도 되는 이유
--------------------------------------
두 앱은 Windows 가 앱을 구분하는 값을 하나도 같이 쓰지 않습니다.

| 항목 | 의료기관 (ADMed) | 일반기관 (ADMed All) | 같으면 생기는 문제 |
| --- | --- | --- | --- |
| appId (설치·제거 항목 GUID 의 근거) | `kr.fine.admed.pc` | `kr.fine.admed.all.pc` | 한쪽 설치가 다른 쪽을 업그레이드·제거 |
| 설치 폴더 (`package.json` `name`) | `%LOCALAPPDATA%\Programs\admed` | `%LOCALAPPDATA%\Programs\admed-all` | 파일 덮어쓰기 |
| 실행 파일 | `ADMed.exe` | `ADMed All.exe` | 설치 프로그램이 실행 중인 상대 앱을 종료 |
| 데이터 폴더 | `%APPDATA%\admed` | `%APPDATA%\ADMed All` (`productName`) | 캐시 정리가 상대 앱 미디어를 지움, 기기 serial·창 위치 공유 |
| 자동 실행 이름 (HKCU Run·시작 프로그램 바로가기) | `ADMed` | `ADMed All` | 한쪽 자동 실행 끄기가 다른 쪽도 끔 |
| 바로가기·트레이·창 제목 | `ADMed` | `ADMed All` | 구분 불가 |
| 자동 업데이트 대상 | `ADMed-2-electron` 릴리스 | `ADMed-all-electron` 릴리스 | 상대 앱 설치 파일로 업데이트 |
| 업데이트 캐시 | `%LOCALAPPDATA%\admed-updater` | `%LOCALAPPDATA%\admed-all-updater` | 받은 설치 파일 섞임 |

로컬 캐시 HTTP 서버는 빈 포트(`listen(0)`)를 받으므로 동시에 실행해도 포트가 겹치지 않습니다.

요구사항
--------
- Node.js 20, npm
- Windows 10/11
- `.env` — [.env.example](.env.example) 을 복사해 씁니다. 필수: `SCENARIO_API_URL`, `TEMPLATE_BASE_URL`

설치 및 실행
------------
```bash
npm install
cp .env.example .env     # 주소 확인 후
npm start                # 개발 실행
npm test                 # 단위 테스트 (node --test)
npm run dist:local       # Windows NSIS 설치 파일 (publish 안 함) → dist/ADMed-All-<버전>-Setup.exe
```
- 기기 일련번호는 `%APPDATA%\ADMed All\device_config.ini` 의 `device_serial` 이며, 우클릭 → 관리자 설정에서 바꿀 수 있습니다(`ADMIN_PASSWORD` 가 있으면 비밀번호 확인).

운영 주소
---------
| 용도 | 주소 |
| --- | --- |
| 시나리오 | `https://www.admed.co.kr/dapi/device/scenario?id={serial}` (`SCENARIO_API_URL`, `?id=` 는 앱이 붙임) |
| 콘텐츠 파일 | `https://www.admed.co.kr/file/local/download/template?img=&type=` (`TEMPLATE_BASE_URL`) |
| 공지 | `{시나리오 origin}/dapi/device/notice?id={serial}` → `[{id,title,content,sort}]`. 공지 속도·글자 크기 배율 필드가 없으면 100% |
| 랜딩(재생목록 없음) | `LANDING_URL`, 기본 `https://www.admed.co.kr` |
| 기기 화면 웹(참고) | `https://device.admed.co.kr` — 이 앱은 쓰지 않음 |

화면 모드(`waitingInfo`): `N` 광고만, `A` +공지, `B` +공지+날씨. `Y`(의료기관 대기현황)는 `N` 으로 바꿉니다.

배포 / 자동 업데이트
-------------------
- 자동 업데이트(`electron-updater`)는 이 저장소 **RedAndBlueOrg/ADMed-all-electron** 의 GitHub Releases 를 봅니다(`package.json` `build.publish`).
- CI(`.github/workflows/release.yml`)는 **`v*` 태그 push 에만** 돕니다. main push·PR 로는 돌지 않습니다.
- 필요한 저장소 secret:
  - `ENV_FILE` — 운영 `.env` 전체 내용. CI 가 `.env` 로 써서 설치 파일 `resources/.env` 에 넣습니다.
  - `GH_TOKEN` — 이 저장소 Releases 쓰기 권한이 있는 토큰.
- 릴리스 절차: `package.json` `version` 을 올리고 커밋 → `git tag v<버전>` → `git push origin v<버전>`. 첫 릴리스는 `v1.0.0` 입니다. 결과는 draft 릴리스로 올라오며, 공개(publish)해야 기기들이 업데이트를 받습니다.
- 자동 업데이트는 설치본(`app.isPackaged`)에서만 동작합니다.

로컬 파일
---------
- `%APPDATA%\ADMed All\device_config.ini` — 기기 일련번호·날씨 좌표
- `%APPDATA%\ADMed All\window-state.ini` — 창 크기/위치/전체화면/항상 위
- `%APPDATA%\ADMed All\scenario-cache.json` — 마지막 시나리오(오프라인 재생용)
- `%APPDATA%\ADMed All\admed-cache\` — 받은 미디어·HLS 패키지

개발 문서는 [CLAUDE.md](CLAUDE.md) 와 [docs/](docs/README.md) 에 있습니다. 의료기관 앱에서 이어받은 문서라 진료 대기현황 설명과 의료기관 버전(2.x) 이력이 남아 있습니다 — 대기현황 코드는 이 앱에서 실행되지 않습니다.
