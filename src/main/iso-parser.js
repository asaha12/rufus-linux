const fs = require('fs');
const path = require('path');

/**
 * Parses an ISO or disk image file to detect volume label, boot type, and OS type
 * @param {string} filePath 
 * @returns {Promise<Object>}
 */
async function parseIsoInfo(filePath) {
  return new Promise((resolve) => {
    const fileName = path.basename(filePath);
    try {
      if (!fs.existsSync(filePath)) {
        return resolve({
          path: filePath,
          fileName,
          size: 0,
          formattedSize: '0 B',
          isIso9660: false,
          volumeId: fileName.replace(/\.[^/.]+$/, "").substring(0, 32),
          systemId: '',
          hasEfi: false,
          hasElTorito: false,
          osType: 'File Not Found',
          isWindows: false,
          recommendedPartitionScheme: 'MBR',
          recommendedTarget: 'BIOS (or UEFI-CSM)',
          recommendedFs: 'FAT32',
          error: 'File does not exist'
        });
      }

      const stats = fs.statSync(filePath);
      const fd = fs.openSync(filePath, 'r');
      
      let isIso9660 = false;
      let volumeId = '';
      let systemId = '';

      // Check ISO 9660 PVD at sector 16 (offset 32768) if file is large enough
      if (stats.size >= 34816) {
        const pvdBuffer = Buffer.alloc(2048);
        fs.readSync(fd, pvdBuffer, 0, 2048, 32768);

        // Standard ISO 9660 identifier is "CD001" at offset 1
        if (pvdBuffer.toString('ascii', 1, 6) === 'CD001') {
          isIso9660 = true;
          systemId = pvdBuffer.toString('utf8', 8, 40).replace(/\0/g, "").trim();
          volumeId = pvdBuffer.toString('utf8', 40, 72).replace(/\0/g, "").trim();
        }
      }

      // Read header (up to 2MB) to detect signatures (EFI, UDF, Windows, Linux, etc.)
      const scanSize = Math.min(stats.size, 2 * 1024 * 1024);
      let headerAscii = '';
      if (scanSize > 0) {
        const headerBuffer = Buffer.alloc(scanSize);
        fs.readSync(fd, headerBuffer, 0, scanSize, 0);
        headerAscii = headerBuffer.toString('latin1');
      }
      fs.closeSync(fd);

      // Check for El Torito boot catalog
      const hasElTorito = headerAscii.includes('EL TORITO SPECIFICATION');

      // Check for EFI boot
      const hasEfi = headerAscii.includes('EFI PART') || 
                     headerAscii.includes('BOOTX64.EFI') || 
                     headerAscii.includes('bootx64.efi') ||
                     headerAscii.includes('EFI') ||
                     headerAscii.includes('UDF') ||
                     volumeId.toLowerCase().includes('uefi');

      // Detect OS Type
      let osType = 'Raw Disk Image';
      let isWindows = false;
      let isUbuntu = false;
      let isDebian = false;
      let isFedora = false;
      let isArch = false;

      const upperVol = volumeId.toUpperCase();
      const lowerPath = filePath.toLowerCase();
      const lowerHeader = headerAscii.toLowerCase();

      // Detection logic
      if (upperVol.includes('WIN') || upperVol.includes('CCCOMA') || upperVol.includes('ESD-ISO') || 
          upperVol.includes('DV9') || upperVol.includes('IR5') || lowerPath.includes('win10') || 
          lowerPath.includes('win11') || lowerPath.includes('windows') || lowerHeader.includes('boot.wim') ||
          lowerHeader.includes('install.wim') || lowerHeader.includes('install.esd') ||
          lowerHeader.includes('microsoft corporation')) {
        isWindows = true;
        osType = 'Windows Installation Media';
      } else if (upperVol.includes('UBUNTU') || lowerPath.includes('ubuntu')) {
        isUbuntu = true;
        osType = 'Ubuntu Linux';
      } else if (upperVol.includes('DEBIAN') || lowerPath.includes('debian')) {
        isDebian = true;
        osType = 'Debian GNU/Linux';
      } else if (upperVol.includes('FEDORA') || lowerPath.includes('fedora')) {
        isFedora = true;
        osType = 'Fedora Linux';
      } else if (upperVol.includes('ARCH') || lowerPath.includes('archlinux')) {
        isArch = true;
        osType = 'Arch Linux';
      } else if (isIso9660) {
        osType = `Standard ISO 9660 (${volumeId || 'Image'})`;
      }

      // Recommended partition scheme & target
      let recommendedPartitionScheme = 'MBR';
      let recommendedTarget = 'BIOS (or UEFI-CSM)';
      let recommendedFs = 'FAT32';

      if (isWindows) {
        recommendedPartitionScheme = 'GPT';
        recommendedTarget = 'UEFI (non CSM)';
        recommendedFs = 'NTFS';
      } else if (hasEfi || isUbuntu || isDebian || isFedora || isArch) {
        recommendedPartitionScheme = 'GPT';
        recommendedTarget = 'UEFI (non CSM)';
        recommendedFs = 'FAT32';
      }

      resolve({
        path: filePath,
        fileName,
        size: stats.size,
        formattedSize: formatBytes(stats.size),
        isIso9660,
        volumeId: volumeId || fileName.replace(/\.[^/.]+$/, "").substring(0, 32),
        systemId,
        hasEfi,
        hasElTorito,
        osType,
        isWindows,
        recommendedPartitionScheme,
        recommendedTarget,
        recommendedFs
      });
    } catch (err) {
      resolve({
        path: filePath,
        fileName,
        size: 0,
        formattedSize: '0 B',
        isIso9660: false,
        volumeId: fileName.replace(/\.[^/.]+$/, "").substring(0, 32),
        systemId: '',
        hasEfi: false,
        hasElTorito: false,
        osType: 'Raw Disk Image',
        isWindows: false,
        recommendedPartitionScheme: 'MBR',
        recommendedTarget: 'BIOS (or UEFI-CSM)',
        recommendedFs: 'FAT32',
        error: err.message
      });
    }
  });
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = { parseIsoInfo, formatBytes };
