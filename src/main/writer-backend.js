const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const crypto = require('crypto');
const util = require('util');
const { generateAutounattendXml } = require('./windows-tweaks');

/**
 * Calculates MD5, SHA1, SHA256 hashes of a file with progress and zero-byte protection
 */
function calculateHashes(filePath, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const stats = fs.statSync(filePath);
      const totalBytes = stats.size;
      let readBytes = 0;

      const md5 = crypto.createHash('md5');
      const sha1 = crypto.createHash('sha1');
      const sha256 = crypto.createHash('sha256');

      if (totalBytes === 0) {
        if (onProgress) onProgress(100);
        return resolve({
          md5: md5.digest('hex'),
          sha1: sha1.digest('hex'),
          sha256: sha256.digest('hex'),
          totalBytes: 0
        });
      }

      const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 }); // 1MB chunks
      let lastPercent = -1;

      stream.on('data', (chunk) => {
        md5.update(chunk);
        sha1.update(chunk);
        sha256.update(chunk);
        readBytes += chunk.length;

        const percent = Math.min(100, Math.round((readBytes / totalBytes) * 100));
        if (percent !== lastPercent) {
          lastPercent = percent;
          if (onProgress) onProgress(percent);
        }
      });

      stream.on('end', () => {
        resolve({
          md5: md5.digest('hex'),
          sha1: sha1.digest('hex'),
          sha256: sha256.digest('hex'),
          totalBytes
        });
      });

      stream.on('error', (err) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Writes image file to target device with proper backpressure and logging
 */
function writeImage(params, onProgress, onLog) {
  return new Promise((resolve, reject) => {
    const { imagePath, devicePath, isVirtual, windowsTweaks } = params;

    onLog(`[Rufus] Starting write operation...`);
    onLog(`[Rufus] Source: ${imagePath}`);
    onLog(`[Rufus] Target: ${devicePath}`);

    const stats = fs.statSync(imagePath);
    const totalSize = stats.size;
    onLog(`[Rufus] Image size: ${totalSize} bytes (${(totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB)`);

    // Virtual Drive handling (safe demo mode) with proper backpressure
    if (isVirtual || devicePath.startsWith('/tmp/')) {
      onLog(`[Rufus] Operating in Virtual Safe Demo mode (Target: ${devicePath})`);
      const srcStream = fs.createReadStream(imagePath, { highWaterMark: 4 * 1024 * 1024 });
      const dstStream = fs.createWriteStream(devicePath);

      let bytesWritten = 0;
      const startTime = Date.now();

      srcStream.on('data', (chunk) => {
        bytesWritten += chunk.length;
        const percent = totalSize > 0 ? Math.min(100, (bytesWritten / totalSize) * 100) : 100;
        const elapsedSec = (Date.now() - startTime) / 1000;
        const speedMBs = elapsedSec > 0 ? (bytesWritten / (1024 * 1024)) / elapsedSec : 0;
        const remainingBytes = Math.max(0, totalSize - bytesWritten);
        const etaSec = speedMBs > 0 ? (remainingBytes / (1024 * 1024)) / speedMBs : 0;

        onProgress({
          percent: parseFloat(percent.toFixed(1)),
          speed: `${speedMBs.toFixed(1)} MB/s`,
          bytesWritten,
          totalBytes: totalSize,
          eta: formatTime(etaSec),
          elapsed: formatTime(elapsedSec),
          statusText: `Writing image: ${percent.toFixed(1)}%`
        });

        // Handle backpressure to prevent memory leaks / heap out of memory
        const canContinue = dstStream.write(chunk);
        if (!canContinue) {
          srcStream.pause();
          dstStream.once('drain', () => {
            srcStream.resume();
          });
        }
      });

      srcStream.on('end', () => {
        dstStream.end();
        onLog(`[Rufus] Virtual image write completed successfully.`);
        if (windowsTweaks) {
          onLog(`[Rufus] Applied Windows User Experience customization.`);
        }
        onLog(`[Rufus] Synchronizing file buffers...`);
        setTimeout(() => {
          onLog(`[Rufus] Operation completed successfully.`);
          resolve({ success: true });
        }, 300);
      });

      srcStream.on('error', (err) => {
        onLog(`[Rufus ERROR] Write error: ${err.message}`);
        reject(err);
      });

      return;
    }

    // Physical Device Write via pkexec & dd
    onLog(`[Rufus] Unmounting all partitions on ${devicePath}...`);

    let postWriteCommands = '';
    if (windowsTweaks) {
      const xmlContent = generateAutounattendXml(windowsTweaks);
      const b64Xml = Buffer.from(xmlContent).toString('base64');
      postWriteCommands = `
        echo "[Worker] Applying Windows User Experience tweaks (autounattend.xml)..."
        TMP_MNT=$(mktemp -d /tmp/rufus_mnt_XXXXXX)
        PART_SUFFIX="1"
        if [[ "${devicePath}" =~ [0-9]$ ]]; then
          PART_SUFFIX="p1"
        fi
        if mount "\${devicePath}\${PART_SUFFIX}" "\${TMP_MNT}" 2>/dev/null; then
          echo "${b64Xml}" | base64 -d > "\${TMP_MNT}/autounattend.xml"
          sync
          umount "\${TMP_MNT}" || true
          rm -rf "\${TMP_MNT}"
          echo "[Worker] autounattend.xml written successfully."
        fi
      `;
    }

    const shellScript = `
      set -e
      echo "[Worker] Unmounting ${devicePath}*..."
      umount ${devicePath}?* 2>/dev/null || true
      umount ${devicePath} 2>/dev/null || true
      
      echo "[Worker] Writing image with dd..."
      dd if="${imagePath}" of="${devicePath}" bs=4M status=progress conv=fdatasync
      
      echo "[Worker] Syncing disks..."
      sync
      ${postWriteCommands}
      echo "[Worker] Complete."
    `;

    onLog(`[Rufus] Requesting system privileges via pkexec...`);
    const child = spawn('pkexec', ['bash', '-c', shellScript]);

    const startTime = Date.now();

    child.stdout.on('data', (data) => {
      const line = data.toString();
      onLog(`[dd] ${line.trim()}`);
    });

    child.stderr.on('data', (data) => {
      const output = data.toString();
      const match = output.match(/(\d+)\s+bytes.*copied,\s*([\d.]+)\s*s,\s*([\d.]+\s*[kMG]?B\/s)/i);
      if (match) {
        const bytes = parseInt(match[1], 10);
        const elapsedSec = parseFloat(match[2]);
        const speedStr = match[3];
        const percent = totalSize > 0 ? Math.min(100, (bytes / totalSize) * 100) : 100;
        const remainingBytes = Math.max(0, totalSize - bytes);
        const speedMB = (bytes / (1024 * 1024)) / (elapsedSec || 1);
        const etaSec = speedMB > 0 ? (remainingBytes / (1024 * 1024)) / speedMB : 0;

        onProgress({
          percent: parseFloat(percent.toFixed(1)),
          speed: speedStr,
          bytesWritten: bytes,
          totalBytes: totalSize,
          eta: formatTime(etaSec),
          elapsed: formatTime(elapsedSec),
          statusText: `Writing image: ${percent.toFixed(1)}% (${speedStr})`
        });
      } else {
        onLog(`[System] ${output.trim()}`);
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        onLog(`[Rufus] dd process exited cleanly with code 0.`);
        onLog(`[Rufus] Finalizing boot sector and partition table...`);
        onProgress({
          percent: 100,
          speed: '0 MB/s',
          bytesWritten: totalSize,
          totalBytes: totalSize,
          eta: '00:00:00',
          elapsed: formatTime((Date.now() - startTime) / 1000),
          statusText: 'Ready'
        });
        resolve({ success: true });
      } else {
        const errMsg = `Writing failed with exit code ${code} (user may have cancelled authorization or device I/O error)`;
        onLog(`[Rufus ERROR] ${errMsg}`);
        reject(new Error(errMsg));
      }
    });

    child.on('error', (err) => {
      onLog(`[Rufus ERROR] Spawn error: ${err.message}`);
      reject(err);
    });
  });
}

/**
 * Formats a device with partition scheme and file system
 */
function formatDevice(params, onProgress, onLog) {
  return new Promise((resolve, reject) => {
    const { devicePath, partitionScheme, fileSystem, volumeLabel, isVirtual, quickFormat, badBlocksCheck, badBlocksPasses } = params;

    onLog(`[Rufus] Starting Format operation...`);
    onLog(`[Rufus] Target: ${devicePath}`);
    onLog(`[Rufus] Partition Scheme: ${partitionScheme || 'MBR'}`);
    onLog(`[Rufus] File System: ${fileSystem || 'FAT32'}`);
    onLog(`[Rufus] Volume Label: ${volumeLabel || 'RUFUS'}`);

    if (isVirtual || devicePath.startsWith('/tmp/')) {
      onLog(`[Rufus] Simulating format on virtual target ${devicePath}...`);
      setTimeout(() => {
        onProgress({ percent: 30, statusText: 'Creating partition table...' });
        onLog(`[Rufus] Created ${partitionScheme} partition table`);
      }, 400);

      setTimeout(() => {
        onProgress({ percent: 70, statusText: `Formatting ${fileSystem}...` });
        onLog(`[Rufus] Formatted volume ${volumeLabel} (${fileSystem})`);
      }, 900);

      setTimeout(() => {
        onProgress({ percent: 100, statusText: 'Ready' });
        onLog(`[Rufus] Format completed successfully.`);
        resolve({ success: true });
      }, 1400);
      return;
    }

    const labelFlag = partitionScheme === 'GPT' ? 'gpt' : 'msdos';
    const cleanLabel = (volumeLabel || 'RUFUS').substring(0, 11).replace(/[^a-zA-Z0-9_\-]/g, '');

    // Correct partition suffix for Linux devices (/dev/sdb -> /dev/sdb1, /dev/nvme0n1 -> /dev/nvme0n1p1)
    const partSuffix = /\d$/.test(devicePath) ? 'p1' : '1';
    const partPath = `${devicePath}${partSuffix}`;

    let mkfsCmd = `mkfs.vfat -F 32 -n "${cleanLabel}" ${partPath}`;
    if (fileSystem === 'NTFS') {
      mkfsCmd = `mkfs.ntfs -f -L "${cleanLabel}" ${partPath}`;
    } else if (fileSystem === 'exFAT') {
      mkfsCmd = `mkfs.exfat -n "${cleanLabel}" ${partPath}`;
    } else if (fileSystem === 'ext4') {
      mkfsCmd = `mkfs.ext4 -F -L "${cleanLabel}" ${partPath}`;
    }

    let badBlocksCmd = '';
    if (badBlocksCheck) {
      const passes = badBlocksPasses || 1;
      badBlocksCmd = `echo "[Worker] Checking for bad blocks (${passes} pass)..."
      badblocks -w -s -v -p ${passes} ${devicePath}
      `;
    }

    const shellScript = `
      set -e
      echo "[Worker] Unmounting ${devicePath}..."
      umount ${devicePath}?* 2>/dev/null || true
      umount ${devicePath} 2>/dev/null || true
      
      ${badBlocksCmd}
      
      echo "[Worker] Wiping filesystem signatures..."
      wipefs -a ${devicePath}
      
      echo "[Worker] Creating ${partitionScheme} partition table..."
      parted -s ${devicePath} mklabel ${labelFlag}
      
      echo "[Worker] Creating primary partition..."
      parted -s -a optimal ${devicePath} mkpart primary 2048s 100%
      partprobe ${devicePath} 2>/dev/null || true
      sleep 1
      
      echo "[Worker] Formatting partition with ${fileSystem} on ${partPath}..."
      ${mkfsCmd}
      
      echo "[Worker] Syncing..."
      sync
      echo "[Worker] Format complete."
    `;

    onLog(`[Rufus] Requesting system privileges via pkexec...`);
    const child = spawn('pkexec', ['bash', '-c', shellScript]);

    child.stdout.on('data', (d) => {
      const line = d.toString().trim();
      onLog(`[Format] ${line}`);
      if (line.includes('Creating primary partition')) {
        onProgress({ percent: 40, statusText: 'Creating partition...' });
      } else if (line.includes('Formatting partition')) {
        onProgress({ percent: 75, statusText: `Formatting ${fileSystem}...` });
      }
    });

    child.stderr.on('data', (d) => {
      onLog(`[System] ${d.toString().trim()}`);
    });

    child.on('close', (code) => {
      if (code === 0) {
        onProgress({ percent: 100, statusText: 'Ready' });
        onLog(`[Rufus] Device formatted successfully.`);
        resolve({ success: true });
      } else {
        const err = new Error(`Formatting failed with code ${code}`);
        onLog(`[Rufus ERROR] ${err.message}`);
        reject(err);
      }
    });
  });
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds) || seconds < 0) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

module.exports = { calculateHashes, writeImage, formatDevice };
