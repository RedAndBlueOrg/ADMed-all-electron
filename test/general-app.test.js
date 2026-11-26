const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');
const state = require('../src/main/state');
const config = require('../src/main/config');
const api = require('../src/main/scenario-api');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

afterEach(() => { state.configIni = {}; });

// 의료기관 앱(ADMed-2-electron: appId kr.fine.admed.pc, name admed, productName ADMed)과 하나라도 같으면
// 한 PC 에서 설치 폴더·제거 항목·데이터 폴더·업데이트 대상이 겹친다.
test('앱 식별자는 일반기관(ADMed All) 전용이다', () => {
  assert.equal(pkg.name, 'admed-all'); // NSIS 설치 폴더·electron-updater 캐시(admed-all-updater)
  assert.equal(pkg.productName, 'ADMed All'); // Electron 앱 이름 → 데이터 폴더 %APPDATA%/ADMed All
  assert.equal(pkg.version, '1.0.0');
  const b = pkg.build;
  assert.equal(b.appId, 'kr.fine.admed.all.pc');
  assert.equal(b.productName, 'ADMed All');
  assert.equal(b.nsis.shortcutName, 'ADMed All');
  assert.equal(b.win.artifactName, 'ADMed-All-${version}-Setup.${ext}'); // 공백 없음(GitHub 가 점으로 바꿈)
  assert.deepEqual(b.publish, [{ provider: 'github', owner: 'RedAndBlueOrg', repo: 'ADMed-all-electron' }]);
  assert.equal(config.AUTO_LAUNCH_NAME, 'ADMed All');
  assert.ok(read('index.html').includes('<title>ADMed All</title>'));
  assert.ok(read('src/main/tray.js').includes("setToolTip('ADMed All')"));
});

test('의료기관 고정값(admed.kr·ADMed-2-electron·2.1.x)이 앱 코드에 남지 않는다', () => {
  const files = ['main.js', 'preload.js', 'index.html', 'package.json',
    ...['src/main', 'src/renderer'].flatMap((d) => fs.readdirSync(path.join(root, d)).map((f) => `${d}/${f}`))];
  assert.ok(files.length > 20, `검사 파일 수 ${files.length}`);
  for (const f of files) {
    const s = read(f);
    for (const bad of ['admed.kr', 'ADMed-2-electron', '2.1.']) assert.ok(!s.includes(bad), `${f} 에 ${bad}`);
  }
});

test('공지 URL 은 /dapi/device/notice?id={serial}, serial 이 없으면 부르지 않는다', () => {
  const scenarioUrl = 'https://www.admed.co.kr:8443/dapi/device/scenario?id=SN%2001';
  state.configIni = { deviceSerial: 'SN 01' };
  assert.equal(api.buildNoticeUrlFromScenario(scenarioUrl), 'https://www.admed.co.kr:8443/dapi/device/notice?id=SN%2001');
  state.configIni = { deviceSerial: '' };
  assert.equal(api.buildNoticeUrlFromScenario(scenarioUrl), null);
});

test('공지 응답 매핑 + 배율 필드가 없으면 100%', async (t) => {
  state.configIni = { deviceSerial: 'SN1' };
  const saved = { SCENARIO_API_URL: process.env.SCENARIO_API_URL, TEMPLATE_BASE_URL: process.env.TEMPLATE_BASE_URL };
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  process.env.SCENARIO_API_URL = 'https://host.test/dapi/device/scenario';
  process.env.TEMPLATE_BASE_URL = 'https://host.test/file/local/download/template';
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(String(url));
    const body = String(url).includes('/notice')
      ? [{ id: 'b-uuid', title: 't2', content: '둘째', sort: 2 }, { id: 'a-uuid', title: 't1', content: '첫째', sort: 1 }]
      : { templates: [], waitingInfo: 'B' }; // 일반기관 응답에는 mSeq·noticeSpeedPct·noticeFontPct 가 없다
    return { ok: true, json: async () => body };
  });
  const result = await api.fetchNoticesFast();
  assert.equal(urls[1], 'https://host.test/dapi/device/notice?id=SN1');
  assert.deepEqual(result.noticeList, [{ id: 'a-uuid', content: '첫째', sort: 1 }, { id: 'b-uuid', content: '둘째', sort: 2 }]);
  assert.equal(result.waitingInfo, 'B');
  assert.equal(result.noticeSpeedPct, 100);
  assert.equal(result.noticeFontPct, 100);
});

test('의료 전용 대기현황(Y)은 N 으로 바꿔 띄우지 않고, 나머지 값은 그대로 둔다', () => {
  for (const [input, expected] of [['Y', 'N'], ['y', 'N'], ['A', 'A'], ['B', 'B'], ['N', 'N'], [null, null], [undefined, undefined]]) {
    assert.equal(api.normalizeWaitingInfo(input), expected, String(input));
  }
});
