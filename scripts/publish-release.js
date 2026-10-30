const fs = require('fs');
const path = require('path');
const https = require('https');

const OWNER = 'asaha12';
const REPO = 'rufus-linux';
const TAG = 'v4.15.0';
const RELEASE_NAME = 'Rufus 4.15 for Linux (Portable AppImage & .deb)';

const TOKEN = process.env.GITHUB_TOKEN || process.argv[2];

if (!TOKEN) {
  console.error('Usage: node scripts/publish-release.js <GITHUB_TOKEN>');
  process.exit(1);
}

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${parsed.message || body}`));
          }
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          }
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function uploadAsset(uploadUrlTemplate, filePath, fileName, contentType) {
  return new Promise((resolve, reject) => {
    const uploadUrl = uploadUrlTemplate.replace(/\{.*?\}$/, `?name=${encodeURIComponent(fileName)}`);
    const parsed = new URL(uploadUrl);
    const stats = fs.statSync(filePath);

    console.log(`Uploading ${fileName} (${(stats.size / (1024 * 1024)).toFixed(1)} MB)...`);

    const req = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'User-Agent': 'Rufus-Linux-Uploader',
        'Authorization': `token ${TOKEN}`,
        'Content-Type': contentType,
        'Content-Length': stats.size
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 201) {
          console.log(`[SUCCESS] Uploaded ${fileName}`);
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Failed to upload ${fileName}: HTTP ${res.statusCode} ${body}`));
        }
      });
    });

    req.on('error', reject);
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.pipe(req);
  });
}

async function main() {
  console.log(`Creating GitHub Release ${TAG} on ${OWNER}/${REPO}...`);

  const releaseBody = `## Rufus 4.15 for Linux (Portable & .deb)

A native Linux utility for formatting and creating bootable USB flash drives.

### Downloads:
- **[Rufus-4.15-x86_64.AppImage](https://github.com/${OWNER}/${REPO}/releases/download/${TAG}/Rufus-4.15-x86_64.AppImage)** (Portable: Click-to-run without installation)
- **[rufus_4.15_amd64.deb](https://github.com/${OWNER}/${REPO}/releases/download/${TAG}/rufus_4.15_amd64.deb)** (Debian/Ubuntu package installer)

### Highlights:
- Complete authentic Rufus interface and workflow
- USB hotplug detection & Root disk safeguard
- Windows User Experience tweaks (Bypass TPM 2.0 / Secure Boot / Account)
- Built-in ISO downloader & Checksum calculator
- GPL v3 License
`;

  try {
    const release = await request({
      hostname: 'api.github.com',
      path: `/repos/${OWNER}/${REPO}/releases`,
      method: 'POST',
      headers: {
        'User-Agent': 'Rufus-Linux-Uploader',
        'Authorization': `token ${TOKEN}`,
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      tag_name: TAG,
      target_commitish: 'main',
      name: RELEASE_NAME,
      body: releaseBody,
      draft: false,
      prerelease: false
    }));

    console.log(`Release created: ${release.html_url}`);

    const appImagePath = path.resolve(__dirname, '../Rufus-4.15-x86_64.AppImage');
    const debPath = path.resolve(__dirname, '../rufus_4.15_amd64.deb');

    await uploadAsset(release.upload_url, appImagePath, 'Rufus-4.15-x86_64.AppImage', 'application/x-executable');
    await uploadAsset(release.upload_url, debPath, 'rufus_4.15_amd64.deb', 'application/vnd.debian.binary-package');

    console.log('\n======================================================');
    console.log('🎉 ALL BINARIES SUCCESSFULLY PUBLISHED TO GITHUB RELEASE!');
    console.log(`View Release: ${release.html_url}`);
    console.log('======================================================');
  } catch (err) {
    console.error('Release failed:', err.message);
    process.exit(1);
  }
}

main();
