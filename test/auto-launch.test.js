const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const pkg = require('../package.json');

// Windows 자동 실행을 맥·리눅스에서 흉내 낸다: HKCU Run 은 가짜 winreg, StartupApproved·schtasks 는 execFile 기록.
// auto-launch 5.x 는 Run 값 이름을 name 옵션이 아니라 exe 파일 이름에서 만든다(fixOpts) — 그래서 설치본 exe 이름
// (productName + .exe)이 AUTO_LAUNCH_NAME 과 같아야 StartupApproved·바로가기 정리가 같은 항목을 가리킨다.
const EXE = `C:\\Users\\u\\AppData\\Local\\Programs\\${pkg.name}\\${pkg.build.productName}.exe`;
const run = new Map([['ADMed', '"C:\\Users\\u\\AppData\\Local\\Programs\\admed\\ADMed.exe"']]); // 의료기관 앱이 먼저 등록돼 있음
const execs = [];
const saved = {};
let appData, autoLaunch, state;

before(() => {
  saved.platform = Object.getOwnPropertyDescriptor(process, 'platform');
  saved.execPath = process.execPath;
  saved.appData = process.env.APPDATA;
  saved.execFile = childProcess.execFile;
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  Object.defineProperty(process.versions, 'electron', { value: '39.2.7', configurable: true });
  process.execPath = EXE;
  appData = fs.mkdtempSync(path.join(os.tmpdir(), 'admed-all-autolaunch-'));
  process.env.APPDATA = appData;
  childProcess.execFile = (cmd, args, _opts, cb) => { execs.push([cmd, ...args]); cb?.(null); };

  class FakeRegistry {
    static HKCU = 'HKCU';
    static REG_SZ = 'REG_SZ';
    constructor({ key }) { assert.equal(key, '\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'); }
    get(name, cb) { run.has(name) ? cb(null, { name, value: run.get(name) }) : cb(new Error('not found')); }
    set(name, _type, value, cb) { run.set(name, value); cb(null); }
    remove(name, cb) { run.delete(name); cb(null); }
  }
  require.cache[require.resolve('winreg')] = { exports: FakeRegistry, loaded: true }; // 새 프로세스라 auto-launch 는 아직 안 불렸다 → 이 가짜를 받는다

  state = require('../src/main/state');
  autoLaunch = require('../src/main/auto-launch');
});

after(() => {
  Object.defineProperty(process, 'platform', saved.platform);
  delete process.versions.electron;
  process.execPath = saved.execPath;
  if (saved.appData === undefined) delete process.env.APPDATA; else process.env.APPDATA = saved.appData;
  childProcess.execFile = saved.execFile;
  fs.rmSync(appData, { recursive: true, force: true });
});

const approved = (name) => execs.filter((a) => a[0] === 'reg' && a.includes(name)).map((a) => a[a.indexOf('/d') + 1]).at(-1);

test('설치본 exe 이름 = AUTO_LAUNCH_NAME = ADMed All (의료기관 ADMed 와 다름)', () => {
  const { AUTO_LAUNCH_NAME } = require('../src/main/config');
  assert.equal(path.win32.basename(EXE, '.exe'), AUTO_LAUNCH_NAME);
  assert.equal(AUTO_LAUNCH_NAME, 'ADMed All');
});

test('시작 시: 꺼진 상태로 읽고, 옛 바로가기는 자기 것만 지운다', async () => {
  const startup = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  fs.mkdirSync(startup, { recursive: true });
  for (const f of ['ADMed All.lnk', 'ADMed.lnk']) fs.writeFileSync(path.join(startup, f), '');

  await autoLaunch.setupAutoLaunch();

  assert.equal(state.autoLaunchEnabled, false);
  assert.equal(approved('ADMed All'), '03,00,00,00,00,00,00,00,00,00,00,00');
  assert.ok(!fs.existsSync(path.join(startup, 'ADMed All.lnk')));
  assert.ok(fs.existsSync(path.join(startup, 'ADMed.lnk')), '의료기관 앱 바로가기를 지우면 안 된다');
  assert.ok(execs.some((a) => a[0] === 'schtasks' && a.includes('ADMed All AutoStart')));
  assert.ok(!execs.some((a) => a[0] === 'schtasks' && a.includes('ADMed AutoStart')));
});

test('켜기: HKCU Run "ADMed All" = 따옴표 친 exe 경로(인자 없음) + StartupApproved 사용(02)', async () => {
  await autoLaunch.setAutoLaunch(true);
  assert.equal(run.get('ADMed All'), `"${EXE}"`);
  assert.equal(state.autoLaunchEnabled, true);
  assert.equal(await autoLaunch.isAutoLaunchEnabled(), true);
  assert.equal(approved('ADMed All'), '02,00,00,00,00,00,00,00,00,00,00,00');
  assert.ok(execs.some((a) => a.join(' ').startsWith('reg add HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run /v ADMed All')));
});

test('끄기: 자기 Run 값만 지우고 의료기관 ADMed 항목은 그대로', async () => {
  await autoLaunch.setAutoLaunch(false);
  assert.equal(run.has('ADMed All'), false);
  assert.equal(state.autoLaunchEnabled, false);
  assert.equal(approved('ADMed All'), '03,00,00,00,00,00,00,00,00,00,00,00');
  assert.ok(run.has('ADMed'), '의료기관 앱 자동 실행이 지워지면 안 된다');
  assert.equal(approved('ADMed'), undefined, '의료기관 StartupApproved 를 건드리면 안 된다');
});
