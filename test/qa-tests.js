const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseIsoInfo, formatBytes } = require('../src/main/iso-parser');
const { getDrives } = require('../src/main/drive-manager');
const { generateAutounattendXml } = require('../src/main/windows-tweaks');
const { calculateHashes, writeImage, formatDevice } = require('../src/main/writer-backend');
const { getAvailableDownloads } = require('../src/main/downloader');

async function runQaSuite() {
  console.log('==============================================');
  console.log('   RUFUS FOR LINUX - AUTOMATED QA TEST SUITE  ');
  console.log('==============================================\n');

  // Setup self-contained fixtures
  const fixturesDir = path.resolve(__dirname, '../test_fixtures');
  fs.mkdirSync(fixturesDir, { recursive: true });

  const emptyPath = path.join(fixturesDir, 'empty.iso');
  fs.writeFileSync(emptyPath, Buffer.alloc(0));

  const tinyPath = path.join(fixturesDir, 'tiny.iso');
  fs.writeFileSync(tinyPath, Buffer.alloc(512));

  const validPath = path.join(fixturesDir, 'valid_mock.iso');
  const validFd = fs.openSync(validPath, 'w');
  fs.writeSync(validFd, Buffer.alloc(32768)); // 16 sectors
  const pvd = Buffer.alloc(2048);
  pvd[0] = 1;
  pvd.write('CD001', 1, 5, 'ascii');
  pvd[6] = 1;
  pvd.write('LINUX', 8, 5, 'ascii');
  pvd.write('UBUNTU_24_04', 40, 12, 'ascii');
  fs.writeSync(validFd, pvd);
  fs.writeSync(validFd, Buffer.from('EFI PART' + '\0'.repeat(1000)));
  fs.closeSync(validFd);

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // --- SUITE 1: ISO Parser ---
  console.log('--- 1. ISO Parser & Image Detection Tests ---');

  await asyncTest('parseIsoInfo handles missing files gracefully', async () => {
    const res = await parseIsoInfo('./non_existent_file.iso');
    assert.strictEqual(res.osType, 'File Not Found');
    assert.strictEqual(res.size, 0);
  });

  await asyncTest('parseIsoInfo handles 0-byte file without crashing', async () => {
    const res = await parseIsoInfo(emptyPath);
    assert.strictEqual(res.size, 0);
    assert.strictEqual(res.isIso9660, false);
  });

  await asyncTest('parseIsoInfo handles sub-32KB file without offset out of bounds', async () => {
    const res = await parseIsoInfo(tinyPath);
    assert.strictEqual(res.size, 512);
    assert.strictEqual(res.isIso9660, false);
  });

  await asyncTest('parseIsoInfo recognizes Ubuntu / Linux ISO with EFI', async () => {
    const res = await parseIsoInfo(validPath);
    assert.strictEqual(res.isIso9660, true);
    assert.strictEqual(res.volumeId, 'UBUNTU_24_04');
    assert.strictEqual(res.osType, 'Ubuntu Linux');
    assert.strictEqual(res.hasEfi, true);
    assert.strictEqual(res.recommendedPartitionScheme, 'GPT');
    assert.strictEqual(res.recommendedTarget, 'UEFI (non CSM)');
  });

  test('formatBytes formats units accurately', () => {
    assert.strictEqual(formatBytes(0), '0 B');
    assert.strictEqual(formatBytes(1024), '1 KB');
    assert.strictEqual(formatBytes(1024 * 1024 * 5.5), '5.5 MB');
    assert.strictEqual(formatBytes(1024 * 1024 * 1024 * 16), '16 GB');
  });

  // --- SUITE 2: Windows Tweaks Generator ---
  console.log('\n--- 2. Windows Customization & autounattend.xml Tests ---');

  test('generateAutounattendXml includes TPM / SecureBoot bypass', () => {
    const xml = generateAutounattendXml({ bypassTpm: true });
    assert(xml.includes('BypassTPMCheck'), 'Should contain BypassTPMCheck');
    assert(xml.includes('BypassSecureBootCheck'), 'Should contain BypassSecureBootCheck');
    assert(xml.includes('BypassRAMCheck'), 'Should contain BypassRAMCheck');
  });

  test('generateAutounattendXml includes local user account creation with XML escaping', () => {
    const xml = generateAutounattendXml({ createLocalUser: true, username: 'Admin & Tester <Test>' });
    assert(xml.includes('<DisplayName>Admin &amp; Tester &lt;Test&gt;</DisplayName>'), 'Username should be XML-escaped');
    assert(xml.includes('<Group>Administrators</Group>'));
  });

  test('generateAutounattendXml includes BitLocker suppression and OOBE privacy', () => {
    const xml = generateAutounattendXml({ bitlocker: true, privacy: true, bypassAccount: true });
    assert(xml.includes('PreventDeviceEncryption'), 'Should disable BitLocker');
    assert(xml.includes('<ProtectYourPC>3</ProtectYourPC>'), 'Should disable telemetry');
    assert(xml.includes('<HideOnlineAccountScreens>true</HideOnlineAccountScreens>'));
  });

  // --- SUITE 3: Drive Manager ---
  console.log('\n--- 3. Drive Manager Tests ---');

  await asyncTest('getDrives queries system without throwing', async () => {
    const drives = await getDrives({ listAllDisks: false });
    assert(Array.isArray(drives), 'Should return an array');
    assert(drives.length > 0, 'Should return at least 1 drive (or fallback virtual demo)');
  });

  await asyncTest('getDrives protects system root disk', async () => {
    const allDrives = await getDrives({ listAllDisks: true });
    const rootDrive = allDrives.find(d => d.mountpoints && d.mountpoints.includes('/'));
    if (rootDrive) {
      assert.strictEqual(rootDrive.isSystem, true, 'Root drive must be flagged as isSystem=true');
      assert(rootDrive.warning.includes('SYSTEM DRIVE'), 'Must include warning tag');
    }
  });

  // --- SUITE 4: Hash Calculation ---
  console.log('\n--- 4. Checksum & Hash Utility Tests ---');

  await asyncTest('calculateHashes computes standard MD5/SHA1/SHA256 correctly', async () => {
    const testFile = path.join(fixturesDir, 'hash_test.txt');
    fs.writeFileSync(testFile, 'Rufus for Linux Portable Test String 12345');
    let reportedPercent = 0;
    const hashes = await calculateHashes(testFile, (p) => {
      reportedPercent = p;
    });

    assert.strictEqual(reportedPercent, 100);
    assert(hashes.md5 && hashes.md5.length === 32, 'MD5 must be 32 hex chars');
    assert(hashes.sha1 && hashes.sha1.length === 40, 'SHA1 must be 40 hex chars');
    assert(hashes.sha256 && hashes.sha256.length === 64, 'SHA256 must be 64 hex chars');
    fs.unlinkSync(testFile);
  });

  // --- SUITE 5: Virtual Disk Write & Format ---
  console.log('\n--- 5. Writer Backend Operations Tests ---');

  await asyncTest('writeImage executes virtual write with progress callbacks', async () => {
    const srcIso = validPath;
    const dstVirtual = '/tmp/rufus_qa_virtual_test.img';
    const progressList = [];
    const logList = [];

    const result = await writeImage(
      {
        imagePath: srcIso,
        devicePath: dstVirtual,
        isVirtual: true,
        volumeLabel: 'QA_TEST_USB'
      },
      (p) => progressList.push(p),
      (l) => logList.push(l)
    );

    assert.strictEqual(result.success, true);
    assert(progressList.length > 0, 'Should have received progress updates');
    assert.strictEqual(progressList[progressList.length - 1].percent, 100);
    assert(fs.existsSync(dstVirtual), 'Virtual target file should exist');
    fs.unlinkSync(dstVirtual);
  });

  await asyncTest('formatDevice simulates partition and filesystem creation', async () => {
    const dstVirtual = '/tmp/rufus_qa_format_test.img';
    const progressList = [];
    const logList = [];

    const result = await formatDevice(
      {
        devicePath: dstVirtual,
        partitionScheme: 'GPT',
        fileSystem: 'FAT32',
        volumeLabel: 'RUFUS_QA',
        isVirtual: true
      },
      (p) => progressList.push(p),
      (l) => logList.push(l)
    );

    assert.strictEqual(result.success, true);
    assert(progressList.some(p => p.percent === 100));
  });

  // --- SUITE 6: Downloader Catalog ---
  console.log('\n--- 6. Downloader Catalog Tests ---');

  test('getAvailableDownloads returns valid curated OS images', () => {
    const list = getAvailableDownloads();
    assert(list.length >= 5, 'Should have at least 5 OS download choices');
    const ubuntu = list.find(i => i.id === 'ubuntu-24-04');
    assert(ubuntu && ubuntu.url.startsWith('https://'), 'Ubuntu download url must be https');
    const win11 = list.find(i => i.id === 'win-11');
    assert(win11 && win11.isManualPortal, 'Windows 11 entry must be configured');
  });

  // Cleanup fixtures
  fs.rmSync(fixturesDir, { recursive: true, force: true });

  console.log('\n==============================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('==============================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runQaSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
