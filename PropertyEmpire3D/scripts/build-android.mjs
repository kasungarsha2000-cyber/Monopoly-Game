#!/usr/bin/env node
/**
 * Build the Android app (APK) for Property Empire 3D:
 *   node scripts/build-android.mjs [output.apk] [--skip-web]
 *
 * 1. Builds the single-file game page into apps/android/assets/www/index.html.
 * 2. Packages resources with aapt, compiles MainActivity with javac, converts it
 *    to dex (d8, or dx on older SDKs), aligns and signs the APK.
 *
 * Needs a JDK (javac, keytool) and Android SDK pieces: a platform android.jar
 * plus aapt, zipalign, apksigner and d8 or dx. They are looked up in
 * $ANDROID_HOME / $ANDROID_SDK_ROOT (Android Studio's SDK), then
 * /usr/lib/android-sdk (Debian/Ubuntu packages), then $PATH.
 *
 * Signing: set PE_ANDROID_KEYSTORE (+ PE_ANDROID_KEYSTORE_PASS, PE_ANDROID_KEY_ALIAS,
 * PE_ANDROID_KEY_PASS) for your own key. Otherwise a debug key is created once in
 * apps/android/.keystore/ (git-ignored); keep it to install updates over an
 * existing copy, because Android only accepts updates signed with the same key.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'apps', 'android');
const build = join(app, 'build');
const args = process.argv.slice(2);
const skipWeb = args.includes('--skip-web');
const outArg = args.find((a) => !a.startsWith('--'));
const win = process.platform === 'win32';

function run(cmd, cmdArgs, opts = {}) {
  execFileSync(cmd, cmdArgs, { stdio: 'inherit', shell: win, ...opts });
}

function onPath(name) {
  const dirs = (process.env.PATH ?? '').split(win ? ';' : ':');
  for (const d of dirs) {
    for (const ext of win ? ['.exe', '.bat', '.cmd', ''] : ['']) {
      const p = join(d, name + ext);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** Highest-numbered child directory (e.g. platforms/android-34, build-tools/34.0.0). */
function newest(dir, filter = () => true) {
  if (!existsSync(dir)) return [];
  const num = (s) => s.split(/[^0-9]+/).filter(Boolean).map(Number);
  return readdirSync(dir)
    .filter((d) => statSync(join(dir, d)).isDirectory() && filter(d))
    .sort((a, b) => {
      const x = num(a);
      const y = num(b);
      for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (y[i] ?? -1) - (x[i] ?? -1);
      return 0;
    })
    .map((d) => join(dir, d));
}

const sdks = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, '/usr/lib/android-sdk'].filter(Boolean);
const buildToolDirs = sdks.flatMap((s) => newest(join(s, 'build-tools')));

function tool(name, ...alternatives) {
  for (const n of [name, ...alternatives]) {
    for (const d of buildToolDirs) {
      for (const ext of win ? ['.exe', '.bat', ''] : ['']) {
        const p = join(d, n + ext);
        if (existsSync(p)) return p;
      }
    }
    const p = onPath(n);
    if (p) return p;
  }
  return null;
}

function javaTool(name) {
  const home = process.env.JAVA_HOME;
  if (home) {
    const p = join(home, 'bin', name + (win ? '.exe' : ''));
    if (existsSync(p)) return p;
  }
  return onPath(name);
}

const androidJar =
  process.env.PE_ANDROID_JAR ??
  sdks.flatMap((s) => newest(join(s, 'platforms'), (d) => d.startsWith('android-')).map((p) => join(p, 'android.jar'))).find((p) => existsSync(p));
const tools = {
  aapt: tool('aapt'),
  zipalign: tool('zipalign'),
  apksigner: tool('apksigner'),
  d8: tool('d8'),
  dx: tool('dx', 'dalvik-exchange'),
  javac: javaTool('javac'),
  keytool: javaTool('keytool')
};
const missing = [!androidJar && 'android.jar (an SDK platform)', ...Object.entries(tools).filter(([k, v]) => !v && k !== 'd8' && k !== 'dx').map(([k]) => k), !tools.d8 && !tools.dx && 'd8 or dx'].filter(Boolean);
if (missing.length) {
  console.error(`Missing Android build tools: ${missing.join(', ')}.`);
  console.error('Install Android Studio (and set ANDROID_HOME), or on Debian/Ubuntu:');
  console.error('  sudo apt-get install android-sdk-platform-23 aapt dalvik-exchange apksigner zipalign');
  process.exit(1);
}
console.log(`Android platform: ${androidJar}`);

// 1. The game page.
if (!skipWeb) run(process.execPath, [join(root, 'scripts', 'build-artifact.mjs'), join(app, 'assets', 'www', 'index.html'), '--document']);
if (!existsSync(join(app, 'assets', 'www', 'index.html'))) throw new Error('apps/android/assets/www/index.html is missing; run without --skip-web');

// 2. Resources, code, dex.
rmSync(build, { recursive: true, force: true });
for (const d of ['gen', 'classes', 'dex']) mkdirSync(join(build, d), { recursive: true });
const unsigned = join(build, 'app.unsigned.apk');
run(tools.aapt, ['package', '-f', '-m', '-J', join(build, 'gen'), '-M', join(app, 'AndroidManifest.xml'), '-S', join(app, 'res'), '-A', join(app, 'assets'), '-I', androidJar, '-F', unsigned]);

const javaFiles = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.java')) javaFiles.push(p);
  }
};
walk(join(app, 'java'));
walk(join(build, 'gen'));
run(tools.javac, ['-source', '8', '-target', '8', '-Xlint:-options', '-encoding', 'UTF-8', '-bootclasspath', androidJar, '-d', join(build, 'classes'), ...javaFiles]);

const classFiles = [];
const walkClasses = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walkClasses(p);
    else if (p.endsWith('.class')) classFiles.push(p);
  }
};
walkClasses(join(build, 'classes'));
if (tools.d8) run(tools.d8, ['--release', '--min-api', '24', '--lib', androidJar, '--output', join(build, 'dex'), ...classFiles]);
else run(tools.dx, ['--dex', '--min-sdk-version=24', `--output=${join(build, 'dex', 'classes.dex')}`, join(build, 'classes')]);
run(tools.aapt, ['add', unsigned, 'classes.dex'], { cwd: join(build, 'dex') });

// 3. Align and sign.
const aligned = join(build, 'app.aligned.apk');
run(tools.zipalign, ['-f', '-p', '4', unsigned, aligned]);

let keystore = process.env.PE_ANDROID_KEYSTORE;
let storePass = process.env.PE_ANDROID_KEYSTORE_PASS;
let alias = process.env.PE_ANDROID_KEY_ALIAS;
let keyPass = process.env.PE_ANDROID_KEY_PASS;
if (!keystore) {
  keystore = join(app, '.keystore', 'debug.jks');
  storePass = 'android';
  keyPass = 'android';
  alias = 'propertyempire';
  if (!existsSync(keystore)) {
    mkdirSync(dirname(keystore), { recursive: true });
    console.log(`Creating a debug signing key in ${keystore}`);
    run(tools.keytool, ['-genkeypair', '-keystore', keystore, '-storepass', storePass, '-keypass', keyPass, '-alias', alias, '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Property Empire 3D debug']);
  }
}
if (!storePass || !alias) throw new Error('Set PE_ANDROID_KEYSTORE_PASS and PE_ANDROID_KEY_ALIAS for your keystore');
const apk = join(build, 'property-empire-3d.apk');
run(tools.apksigner, ['sign', '--ks', keystore, '--ks-pass', `pass:${storePass}`, '--key-pass', `pass:${keyPass ?? storePass}`, '--ks-key-alias', alias, '--out', apk, aligned]);
run(tools.apksigner, ['verify', apk]);

if (outArg) {
  mkdirSync(dirname(resolve(outArg)), { recursive: true });
  copyFileSync(apk, resolve(outArg));
}
const size = (statSync(apk).size / 1024 / 1024).toFixed(2);
console.log(`\nBuilt ${outArg ? resolve(outArg) : apk} (${size} MB)`);
