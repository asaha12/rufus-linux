const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const os = require('os');

const ISO_CATALOG = [
  {
    id: 'ubuntu-24-04',
    name: 'Ubuntu 24.04.1 LTS Desktop (64-bit)',
    os: 'Linux',
    size: '5.8 GB',
    url: 'https://releases.ubuntu.com/24.04.1/ubuntu-24.04.1-desktop-amd64.iso',
    filename: 'ubuntu-24.04.1-desktop-amd64.iso'
  },
  {
    id: 'debian-12',
    name: 'Debian 12.8.0 Netinst (64-bit)',
    os: 'Linux',
    size: '640 MB',
    url: 'https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-12.8.0-amd64-netinst.iso',
    filename: 'debian-12.8.0-amd64-netinst.iso'
  },
  {
    id: 'fedora-40',
    name: 'Fedora Workstation 40 (64-bit)',
    os: 'Linux',
    size: '2.1 GB',
    url: 'https://download.fedoraproject.org/pub/fedora/linux/releases/40/Workstation/x86_64/iso/Fedora-Workstation-Live-x86_64-40-1.14.iso',
    filename: 'Fedora-Workstation-Live-x86_64-40-1.14.iso'
  },
  {
    id: 'arch-linux',
    name: 'Arch Linux Latest ISO (x86_64)',
    os: 'Linux',
    size: '1.1 GB',
    url: 'https://geo.mirror.pkgbuild.com/iso/latest/archlinux-x86_64.iso',
    filename: 'archlinux-latest-x86_64.iso'
  },
  {
    id: 'linux-mint-22',
    name: 'Linux Mint 22 Cinnamon Edition (64-bit)',
    os: 'Linux',
    size: '2.9 GB',
    url: 'https://mirrors.edge.kernel.org/linuxmint/stable/22/linuxmint-22-cinnamon-64bit.iso',
    filename: 'linuxmint-22-cinnamon-64bit.iso'
  },
  {
    id: 'win-11',
    name: 'Windows 11 23H2/24H2 (Official Microsoft Portal)',
    os: 'Windows',
    size: '5.4 GB',
    url: 'https://www.microsoft.com/software-download/windows11',
    isManualPortal: true,
    filename: 'Win11_English_x64.iso'
  }
];

let activeDownloadReq = null;

function getAvailableDownloads() {
  return ISO_CATALOG;
}

function startDownload(isoId, onProgress, onLog) {
  return new Promise((resolve, reject) => {
    const item = ISO_CATALOG.find(i => i.id === isoId);
    if (!item) {
      return reject(new Error('Selected ISO item not found in catalog'));
    }

    if (item.isManualPortal) {
      return resolve({ manualUrl: item.url, isManual: true });
    }

    const downloadDir = path.join(os.homedir(), 'Downloads');
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }
    const targetFile = path.join(downloadDir, item.filename);

    onLog(`[Downloader] Starting download: ${item.name}`);
    onLog(`[Downloader] Destination: ${targetFile}`);

    const fileStream = fs.createWriteStream(targetFile);

    function fetchUrl(targetUrl) {
      const client = targetUrl.startsWith('https') ? https : http;
      activeDownloadReq = client.get(targetUrl, (res) => {
        // Handle HTTP redirects (301, 302, 303, 307)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          onLog(`[Downloader] Redirecting to: ${res.headers.location}`);
          return fetchUrl(res.headers.location);
        }

        if (res.statusCode !== 200) {
          fileStream.close();
          fs.unlink(targetFile, () => {});
          const err = new Error(`HTTP Error ${res.statusCode}: ${res.statusMessage}`);
          onLog(`[Downloader ERROR] ${err.message}`);
          return reject(err);
        }

        const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
        let receivedBytes = 0;
        const startTime = Date.now();

        res.on('data', (chunk) => {
          receivedBytes += chunk.length;
          fileStream.write(chunk);

          const percent = totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 0;
          const elapsedSec = (Date.now() - startTime) / 1000;
          const speedMBs = elapsedSec > 0 ? (receivedBytes / (1024 * 1024)) / elapsedSec : 0;
          const remainingBytes = Math.max(0, totalBytes - receivedBytes);
          const etaSec = speedMBs > 0 ? (remainingBytes / (1024 * 1024)) / speedMBs : 0;

          onProgress({
            percent: parseFloat(percent.toFixed(1)),
            speed: `${speedMBs.toFixed(2)} MB/s`,
            received: (receivedBytes / (1024 * 1024)).toFixed(1) + ' MB',
            total: (totalBytes / (1024 * 1024)).toFixed(1) + ' MB',
            eta: formatEta(etaSec)
          });
        });

        res.on('end', () => {
          fileStream.end();
          onLog(`[Downloader] Download completed successfully: ${targetFile}`);
          resolve({ filePath: targetFile, isManual: false });
        });

        res.on('error', (err) => {
          fileStream.close();
          fs.unlink(targetFile, () => {});
          reject(err);
        });
      });

      activeDownloadReq.on('error', (err) => {
        fileStream.close();
        fs.unlink(targetFile, () => {});
        reject(err);
      });
    }

    fetchUrl(item.url);
  });
}

function cancelDownload() {
  if (activeDownloadReq) {
    activeDownloadReq.destroy();
    activeDownloadReq = null;
  }
}

function formatEta(sec) {
  if (!sec || isNaN(sec) || sec < 0) return '--:--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

module.exports = { getAvailableDownloads, startDownload, cancelDownload };
