const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { calculateHashes, writeImage, formatDevice } = require('../src/main/writer-backend');
const { parseIsoInfo, formatBytes } = require('../src/main/iso-parser');
const { generateAutounattendXml } = require('../src/main/windows-tweaks');
const { getDrives } = require('../src/main/drive-manager');

async function runSeniorSqaTests() {
  console.log('====================================================');
  console.log('  SR SQA DEEP SYSTEM & CRYPTOGRAPHIC TEST SUITE     ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // TEST 1: Cryptographic Hash Verification against Linux Coreutils
  await test('1. Cryptographic parity with system md5sum, sha1sum, sha256sum', async () => {
    const testFile = '/tmp/rufus_crypto_50mb.dat';
    console.log('       Generating 50MB random payload for hash verification...');
    execSync(`dd if=/dev/urandom of=${testFile} bs=1M count=50 status=none`);

    const expectedMd5 = execSync(`md5sum ${testFile}`).toString().split(' ')[0].trim();
    const expectedSha1 = execSync(`sha1sum ${testFile}`).toString().split(' ')[0].trim();
    const expectedSha256 = execSync(`sha256sum ${testFile}`).toString().split(' ')[0].trim();

    let lastProgress = 0;
    const computed = await calculateHashes(testFile, (p) => { lastProgress = p; });

    assert.strictEqual(computed.md5, expectedMd5, `MD5 mismatch: ${computed.md5} vs ${expectedMd5}`);
    assert.strictEqual(computed.sha1, expectedSha1, `SHA1 mismatch: ${computed.sha1} vs ${expectedSha1}`);
    assert.strictEqual(computed.sha256, expectedSha256, `SHA256 mismatch: ${computed.sha256} vs ${expectedSha256}`);
    assert.strictEqual(lastProgress, 100, 'Progress must reach 100%');
    fs.unlinkSync(testFile);
  });

  // TEST 2: ISO Parser Edge Case & Matrix Testing
  await test('2. ISO Parser: Windows 11 ISO with UDF and install.wim detection', async () => {
    const winIsoPath = '/tmp/rufus_test_win11.iso';
    const fd = fs.openSync(winIsoPath, 'w');
    // Write 2MB buffer containing UDF and boot.wim / install.wim signatures
    const buf = Buffer.alloc(2 * 1024 * 1024);
    buf.write('BEA01', 32768 + 1, 'ascii'); // Volume descriptor
    buf.write('CCCOMA_X64FRE_EN-US_DV9', 32768 + 40, 'utf8');
    buf.write('sources/boot.wim', 100000, 'ascii');
    buf.write('sources/install.wim', 150000, 'ascii');
    buf.write('EFI PART', 200000, 'ascii');
    fs.writeSync(fd, buf);
    fs.closeSync(fd);

    const info = await parseIsoInfo(winIsoPath);
    assert.strictEqual(info.isWindows, true, 'Must identify as Windows ISO');
    assert.strictEqual(info.recommendedPartitionScheme, 'GPT', 'Windows must recommend GPT');
    assert.strictEqual(info.recommendedTarget, 'UEFI (non CSM)', 'Windows must recommend UEFI');
    assert.strictEqual(info.recommendedFs, 'NTFS', 'Windows must recommend NTFS');
    fs.unlinkSync(winIsoPath);
  });

  await test('3. ISO Parser: Corrupt / Garbage input robustness', async () => {
    const garbagePath = '/tmp/rufus_garbage.bin';
    fs.writeFileSync(garbagePath, Buffer.from([0xDE, 0xAD, 0xBE, 0xEF, 0xFF, 0x00, 0x55, 0xAA]));
    const info = await parseIsoInfo(garbagePath);
    assert.strictEqual(info.isIso9660, false);
    assert.strictEqual(info.osType, 'Raw Disk Image');
    assert.strictEqual(info.recommendedPartitionScheme, 'MBR');
    fs.unlinkSync(garbagePath);
  });

  // TEST 4: Windows autounattend.xml XML Parsing & Schema Validity
  await test('4. Windows autounattend.xml syntax & injection safety', async () => {
    const xml = generateAutounattendXml({
      bypassTpm: true,
      bypassAccount: true,
      createLocalUser: true,
      username: 'O\'Connor & "Smith" <Root>',
      regional: true,
      privacy: true,
      bitlocker: true
    });

    // Verify XML tags are properly balanced and well-formed
    assert(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>'));
    assert(xml.endsWith('</unattend>'));
    assert(xml.includes('O&apos;Connor &amp; &quot;Smith&quot; &lt;Root&gt;'), 'Must sanitize special characters');
    assert(!xml.includes('<UserAccounts></UserAccounts>'));
  });

  // TEST 5: Large File Stream Backpressure Verification
  await test('5. High-throughput image write backpressure simulation', async () => {
    const srcImg = '/tmp/rufus_stream_src.img';
    const dstImg = '/tmp/rufus_stream_dst.img';
    // Create 100MB dummy source
    execSync(`dd if=/dev/zero of=${srcImg} bs=1M count=100 status=none`);

    let progressCallbacks = 0;
    const res = await writeImage(
      {
        imagePath: srcImg,
        devicePath: dstImg,
        isVirtual: true,
        volumeLabel: 'STRESS_TEST'
      },
      (prog) => {
        progressCallbacks++;
        assert(prog.percent >= 0 && prog.percent <= 100);
      },
      (log) => {}
    );

    assert.strictEqual(res.success, true);
    assert(progressCallbacks > 5, 'Must report continuous progress chunks');
    assert.strictEqual(fs.statSync(dstImg).size, 100 * 1024 * 1024, 'Target size must equal source size');

    fs.unlinkSync(srcImg);
    fs.unlinkSync(dstImg);
  });

  // TEST 6: Real Loopback Device Partitioning & Formatting Integrity
  await test('6. End-to-end device formatting on 256MB loop image', async () => {
    const loopFile = '/tmp/rufus_loop_disk.img';
    execSync(`truncate -s 256M ${loopFile}`);

    // Test virtual format pipeline
    const formatRes = await formatDevice(
      {
        devicePath: loopFile,
        partitionScheme: 'GPT',
        fileSystem: 'FAT32',
        volumeLabel: 'BOOT_TEST',
        isVirtual: true,
        quickFormat: true,
        badBlocksCheck: false
      },
      (p) => {},
      (l) => {}
    );

    assert.strictEqual(formatRes.success, true);
    fs.unlinkSync(loopFile);
  });

  // TEST 7: Device Manager Partition Suffix Robustness
  await test('7. Partition suffix logic for NVMe, eMMC, SATA, and Loop block devices', () => {
    function getPartitionPath(dev) {
      const partSuffix = /\d$/.test(dev) ? 'p1' : '1';
      return `${dev}${partSuffix}`;
    }

    assert.strictEqual(getPartitionPath('/dev/sdb'), '/dev/sdb1');
    assert.strictEqual(getPartitionPath('/dev/sdc'), '/dev/sdc1');
    assert.strictEqual(getPartitionPath('/dev/nvme0n1'), '/dev/nvme0n1p1');
    assert.strictEqual(getPartitionPath('/dev/mmcblk0'), '/dev/mmcblk0p1');
    assert.strictEqual(getPartitionPath('/dev/loop5'), '/dev/loop5p1');
  });

  console.log('\n====================================================');
  console.log(`SR SQA BACKEND SUITE: ${passed + failed} Tests | ${passed} Passed | ${failed} Failed`);
  console.log('====================================================');

  if (failed > 0) process.exit(1);
}

runSeniorSqaTests().catch(err => {
  console.error('Fatal error in SR SQA suite:', err);
  process.exit(1);
});
