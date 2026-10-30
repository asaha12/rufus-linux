const { ipcRenderer } = require('electron');

// State variables
let currentDrives = [];
let selectedDrive = null;
let selectedIsoInfo = null;
let isOperating = false;
let logs = [];
let pendingWindowsTweaks = null;
let pollTimer = null;

// DOM Elements
const dragDropOverlay = document.getElementById('drag-drop-overlay');
const selectDevice = document.getElementById('select-device');
const btnRefreshDrives = document.getElementById('btn-refresh-drives');
const btnToggleAdvDrive = document.getElementById('btn-toggle-adv-drive');
const arrowAdvDrive = document.getElementById('arrow-adv-drive');
const advDrivePanel = document.getElementById('adv-drive-panel');
const chkListAllDisks = document.getElementById('chk-list-all-disks');

const selectBoot = document.getElementById('select-boot');
const btnSelectIso = document.getElementById('btn-select-iso');
const btnDownloadIso = document.getElementById('btn-download-iso');
const hiddenFileInput = document.getElementById('hidden-file-input');
const isoInfoCard = document.getElementById('iso-info-card');
const isoNameDisplay = document.getElementById('iso-name-display');
const isoSizeDisplay = document.getElementById('iso-size-display');
const isoOsBadge = document.getElementById('iso-os-badge');
const isoBootBadge = document.getElementById('iso-boot-badge');

const rowImageOption = document.getElementById('row-image-option');
const selectImageOption = document.getElementById('select-image-option');
const selectPartition = document.getElementById('select-partition');
const selectTarget = document.getElementById('select-target');

const inputVolumeLabel = document.getElementById('input-volume-label');
const selectFilesystem = document.getElementById('select-filesystem');
const selectClustersize = document.getElementById('select-clustersize');
const btnToggleAdvFormat = document.getElementById('btn-toggle-adv-format');
const arrowAdvFormat = document.getElementById('arrow-adv-format');
const advFormatPanel = document.getElementById('adv-format-panel');
const chkQuickFormat = document.getElementById('chk-quick-format');
const chkBadBlocks = document.getElementById('chk-bad-blocks');
const selectBadBlocksPasses = document.getElementById('select-bad-blocks-passes');

const statusLabel = document.getElementById('status-label');
const statusPercentage = document.getElementById('status-percentage');
const progressBarFill = document.getElementById('progress-bar-fill');
const metricSpeed = document.getElementById('metric-speed');
const metricEta = document.getElementById('metric-eta');
const metricElapsed = document.getElementById('metric-elapsed');

const btnToggleLog = document.getElementById('btn-toggle-log');
const btnStart = document.getElementById('btn-start');
const btnClose = document.getElementById('btn-close');

// Notice Modal (replaces window.alert)
const modalNotice = document.getElementById('modal-notice');
const noticeIcon = document.getElementById('notice-icon');
const noticeMessage = document.getElementById('notice-message');
const btnNoticeOk = document.getElementById('btn-notice-ok');

function showNotice(msg, icon = 'ℹ️') {
  noticeIcon.textContent = icon;
  noticeMessage.textContent = msg;
  modalNotice.classList.remove('hidden');
}

btnNoticeOk.addEventListener('click', () => {
  modalNotice.classList.add('hidden');
});

// Modals
const modalLog = document.getElementById('modal-log');
const logTextarea = document.getElementById('log-textarea');
const btnCloseLog = document.getElementById('btn-close-log');
const btnDismissLog = document.getElementById('btn-dismiss-log');
const btnCopyLog = document.getElementById('btn-copy-log');
const btnClearLog = document.getElementById('btn-clear-log');

const modalHash = document.getElementById('modal-hash');
const btnHashTool = document.getElementById('btn-hash-tool');
const btnCloseHash = document.getElementById('btn-close-hash');
const btnDismissHash = document.getElementById('btn-dismiss-hash');
const hashLoadingView = document.getElementById('hash-loading-view');
const hashResultsView = document.getElementById('hash-results-view');
const hashProgressFill = document.getElementById('hash-progress-fill');
const hashMd5 = document.getElementById('hash-md5');
const hashSha1 = document.getElementById('hash-sha1');
const hashSha256 = document.getElementById('hash-sha256');

const modalWindowsTweaks = document.getElementById('modal-windows-tweaks');
const btnCloseTweaks = document.getElementById('btn-close-tweaks');
const btnApplyTweaks = document.getElementById('btn-apply-tweaks');
const btnCancelTweaks = document.getElementById('btn-cancel-tweaks');
const tweakTpm = document.getElementById('tweak-tpm');
const tweakAccount = document.getElementById('tweak-account');
const tweakLocaluser = document.getElementById('tweak-localuser');
const tweakUsername = document.getElementById('tweak-username');
const tweakRegional = document.getElementById('tweak-regional');
const tweakPrivacy = document.getElementById('tweak-privacy');
const tweakBitlocker = document.getElementById('tweak-bitlocker');

const modalDownloader = document.getElementById('modal-downloader');
const btnCloseDownloader = document.getElementById('btn-close-downloader');
const btnDismissDownloader = document.getElementById('btn-dismiss-downloader');
const downloadListContainer = document.getElementById('download-list-container');
const downloadProgressContainer = document.getElementById('download-progress-container');
const dlStatusTitle = document.getElementById('dl-status-title');
const dlStatusPercent = document.getElementById('dl-status-percent');
const dlProgressFill = document.getElementById('dl-progress-fill');
const dlMetricSpeed = document.getElementById('dl-metric-speed');
const dlMetricDownloaded = document.getElementById('dl-metric-downloaded');
const dlMetricEta = document.getElementById('dl-metric-eta');
const btnCancelDl = document.getElementById('btn-cancel-dl');

const modalConfirm = document.getElementById('modal-confirm');
const confirmDeviceMsg = document.getElementById('confirm-device-msg');
const btnConfirmOk = document.getElementById('btn-confirm-ok');
const btnConfirmCancel = document.getElementById('btn-confirm-cancel');

const modalSettings = document.getElementById('modal-settings');
const btnSettingsTool = document.getElementById('btn-settings-tool');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnDismissSettings = document.getElementById('btn-dismiss-settings');

const modalAbout = document.getElementById('modal-about');
const btnAboutTool = document.getElementById('btn-about-tool');
const btnCloseAbout = document.getElementById('btn-close-about');
const btnDismissAbout = document.getElementById('btn-dismiss-about');

// Logging helper
function appendLog(msg) {
  const timestamp = new Date().toLocaleTimeString();
  const line = `[${timestamp}] ${msg}`;
  logs.push(line);
  if (logTextarea) {
    logTextarea.value = logs.join('\n');
    logTextarea.scrollTop = logTextarea.scrollHeight;
  }
}

// Drive fetching & auto polling
async function loadDrives(silent = false) {
  try {
    const listAll = chkListAllDisks.checked;
    const newDrives = await ipcRenderer.invoke('get-drives', { listAllDisks: listAll });
    
    // Check if drives list actually changed before re-rendering select
    const currentJson = JSON.stringify(currentDrives.map(d => d.path));
    const newJson = JSON.stringify(newDrives.map(d => d.path));
    
    if (currentJson === newJson && currentDrives.length > 0) {
      return;
    }

    currentDrives = newDrives;
    selectDevice.innerHTML = '';

    if (currentDrives.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No drives detected';
      selectDevice.appendChild(opt);
      selectedDrive = null;
    } else {
      currentDrives.forEach((drv, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = drv.displayName;
        if (drv.warning) {
          opt.style.color = '#d13438';
        }
        selectDevice.appendChild(opt);
      });
      selectedDrive = currentDrives[0];
      if (!silent) {
        appendLog(`Found ${currentDrives.length} drives. Selected: ${selectedDrive.displayName}`);
      }
    }
  } catch (err) {
    if (!silent) appendLog(`Failed to scan drives: ${err.message}`);
  }
}

// Auto-poll every 2.5s for USB insertion/removal
pollTimer = setInterval(() => {
  if (!isOperating) {
    loadDrives(true);
  }
}, 2500);

selectDevice.addEventListener('change', () => {
  const idx = parseInt(selectDevice.value, 10);
  if (!isNaN(idx) && currentDrives[idx]) {
    selectedDrive = currentDrives[idx];
    appendLog(`Selected drive changed to: ${selectedDrive.displayName}`);
    if (selectedDrive.warning) {
      showNotice(`ATTENTION: ${selectedDrive.displayName}\n\n${selectedDrive.warning}`, '⚠️');
    }
  }
});

btnRefreshDrives.addEventListener('click', () => {
  loadDrives(false);
});

chkListAllDisks.addEventListener('change', () => {
  loadDrives(false);
});

// Expanders
btnToggleAdvDrive.addEventListener('click', () => {
  const isOpen = advDrivePanel.classList.toggle('open');
  arrowAdvDrive.textContent = isOpen ? '▼' : '►';
  btnToggleAdvDrive.innerHTML = `<span class="expander-arrow">${arrowAdvDrive.textContent}</span> ${isOpen ? 'Hide' : 'Show'} advanced drive properties`;
});

btnToggleAdvFormat.addEventListener('click', () => {
  const isOpen = advFormatPanel.classList.toggle('open');
  arrowAdvFormat.textContent = isOpen ? '▼' : '►';
  btnToggleAdvFormat.innerHTML = `<span class="expander-arrow">${arrowAdvFormat.textContent}</span> ${isOpen ? 'Hide' : 'Show'} advanced format options`;
});

chkBadBlocks.addEventListener('change', () => {
  selectBadBlocksPasses.disabled = !chkBadBlocks.checked;
});

// Boot mode changes
selectBoot.addEventListener('change', () => {
  const mode = selectBoot.value;
  if (mode === 'iso') {
    btnSelectIso.disabled = false;
    btnDownloadIso.disabled = false;
    if (selectedIsoInfo) {
      isoInfoCard.classList.remove('hidden');
    }
  } else {
    btnSelectIso.disabled = true;
    btnDownloadIso.disabled = true;
    isoInfoCard.classList.add('hidden');
    rowImageOption.style.display = 'none';
    if (mode === 'freedos') {
      inputVolumeLabel.value = 'FREEDOS';
      selectFilesystem.value = 'FAT32';
    } else if (mode === 'nonbootable') {
      inputVolumeLabel.value = 'DATA_USB';
    }
  }
});

// ISO File Selection
btnSelectIso.addEventListener('click', async () => {
  appendLog('Opening file chooser for ISO / Disk image...');
  try {
    const isoInfo = await ipcRenderer.invoke('open-file-dialog');
    if (isoInfo) {
      applyIsoInfo(isoInfo);
    } else {
      // Fallback: trigger hidden input if portal cancelled
      hiddenFileInput.click();
    }
  } catch (err) {
    appendLog(`Fallback to local file chooser: ${err.message}`);
    hiddenFileInput.click();
  }
});

hiddenFileInput.addEventListener('change', async (e) => {
  if (e.target.files && e.target.files[0]) {
    const file = e.target.files[0];
    const filePath = file.path || file.name;
    try {
      const isoInfo = await ipcRenderer.invoke('parse-iso', filePath);
      applyIsoInfo(isoInfo);
    } catch (err) {
      appendLog(`Error parsing file: ${err.message}`);
    }
  }
});

// Drag and Drop ISO handling
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  dragDropOverlay.classList.add('active');
});

window.addEventListener('dragleave', (e) => {
  if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
    dragDropOverlay.classList.remove('active');
  }
});

window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDropOverlay.classList.remove('active');
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    const file = e.dataTransfer.files[0];
    const filePath = file.path;
    if (filePath) {
      appendLog(`File dropped: ${filePath}`);
      try {
        const isoInfo = await ipcRenderer.invoke('parse-iso', filePath);
        applyIsoInfo(isoInfo);
        selectBoot.value = 'iso';
        btnSelectIso.disabled = false;
        btnDownloadIso.disabled = false;
      } catch (err) {
        showNotice(`Failed to parse dropped image: ${err.message}`, '❌');
      }
    }
  }
});

function applyIsoInfo(info) {
  selectedIsoInfo = info;
  appendLog(`Loaded image: ${info.fileName} (${info.formattedSize})`);
  appendLog(`Detected: ${info.osType}, EFI: ${info.hasEfi}, Recommended FS: ${info.recommendedFs}`);

  isoNameDisplay.textContent = info.fileName;
  isoSizeDisplay.textContent = info.formattedSize;
  isoOsBadge.textContent = info.osType;
  isoBootBadge.textContent = info.hasEfi ? 'UEFI + BIOS' : 'BIOS standard';
  isoInfoCard.classList.remove('hidden');

  // Auto-fill volume label
  if (info.volumeId) {
    inputVolumeLabel.value = info.volumeId.replace(/[^a-zA-Z0-9_\-]/g, '').substring(0, 32);
  }

  // Auto-set partition scheme and target
  selectPartition.value = info.recommendedPartitionScheme;
  selectTarget.value = info.recommendedTarget.includes('UEFI') ? 'uefi' : 'bios';
  selectFilesystem.value = info.recommendedFs;

  // Show Windows options if Windows ISO
  if (info.isWindows) {
    rowImageOption.style.display = 'flex';
  } else {
    rowImageOption.style.display = 'none';
  }

  statusLabel.textContent = 'Ready';
}

// Hashes Modal
btnHashTool.addEventListener('click', () => {
  if (!selectedIsoInfo) {
    showNotice('Please select an ISO or disk image first before calculating hashes.', 'ℹ️');
    return;
  }
  modalHash.classList.remove('hidden');
  hashLoadingView.classList.remove('hidden');
  hashResultsView.classList.add('hidden');
  hashProgressFill.style.width = '0%';

  appendLog(`Calculating hashes (MD5, SHA1, SHA256) for ${selectedIsoInfo.path}...`);
  ipcRenderer.invoke('calculate-hashes', selectedIsoInfo.path).then((hashes) => {
    hashMd5.value = hashes.md5;
    hashSha1.value = hashes.sha1;
    hashSha256.value = hashes.sha256;
    hashLoadingView.classList.add('hidden');
    hashResultsView.classList.remove('hidden');
    appendLog(`Hash calculations finished: SHA256 = ${hashes.sha256}`);
  }).catch((err) => {
    showNotice(`Failed to compute hashes: ${err.message}`, '❌');
    modalHash.classList.add('hidden');
  });
});

ipcRenderer.on('hash-progress', (event, percent) => {
  hashProgressFill.style.width = `${percent}%`;
});

btnCloseHash.addEventListener('click', () => modalHash.classList.add('hidden'));
btnDismissHash.addEventListener('click', () => modalHash.classList.add('hidden'));

document.querySelectorAll('.copy-hash-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.getAttribute('data-target');
    const input = document.getElementById(targetId);
    if (input) {
      navigator.clipboard.writeText(input.value);
      const originalText = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = originalText, 1500);
    }
  });
});

// Windows Tweaks Modal
btnCloseTweaks.addEventListener('click', () => modalWindowsTweaks.classList.add('hidden'));
btnCancelTweaks.addEventListener('click', () => modalWindowsTweaks.classList.add('hidden'));
btnApplyTweaks.addEventListener('click', () => {
  modalWindowsTweaks.classList.add('hidden');
  pendingWindowsTweaks = {
    bypassTpm: tweakTpm.checked,
    bypassAccount: tweakAccount.checked,
    createLocalUser: tweakLocaluser.checked,
    username: tweakUsername.value || 'User',
    regional: tweakRegional.checked,
    privacy: tweakPrivacy.checked,
    bitlocker: tweakBitlocker.checked
  };
  appendLog(`Configured Windows User Experience customization for user "${pendingWindowsTweaks.username}"`);
  promptConfirmation();
});

// Downloader Modal
btnDownloadIso.addEventListener('click', async () => {
  modalDownloader.classList.remove('hidden');
  downloadListContainer.innerHTML = 'Loading available OS ISO images...';
  downloadProgressContainer.classList.add('hidden');
  btnCancelDl.classList.add('hidden');

  try {
    const list = await ipcRenderer.invoke('get-downloads');
    downloadListContainer.innerHTML = '';
    list.forEach(item => {
      const card = document.createElement('div');
      card.className = 'download-item';
      card.innerHTML = `
        <div class="download-info">
          <span class="download-title">${item.name}</span>
          <span class="download-sub">${item.os} • ${item.size}</span>
        </div>
        <button class="btn btn-primary download-action-btn" data-id="${item.id}">
          ${item.isManualPortal ? 'Open Portal ↗' : 'Download'}
        </button>
      `;
      downloadListContainer.appendChild(card);
    });

    document.querySelectorAll('.download-action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const isoId = btn.getAttribute('data-id');
        triggerDownload(isoId);
      });
    });
  } catch (err) {
    downloadListContainer.innerHTML = `Failed to load download catalog: ${err.message}`;
  }
});

async function triggerDownload(isoId) {
  downloadProgressContainer.classList.remove('hidden');
  btnCancelDl.classList.remove('hidden');
  dlProgressFill.style.width = '0%';
  dlStatusPercent.textContent = '0%';

  try {
    const result = await ipcRenderer.invoke('start-download', isoId);
    if (result.isManual) {
      ipcRenderer.invoke('open-url', result.manualUrl);
      modalDownloader.classList.add('hidden');
      return;
    }

    if (result.filePath) {
      appendLog(`ISO Downloaded to ${result.filePath}`);
      const info = await ipcRenderer.invoke('parse-iso', result.filePath);
      applyIsoInfo(info);
      modalDownloader.classList.add('hidden');
    }
  } catch (err) {
    showNotice(`Download failed: ${err.message}`, '❌');
  }
}

ipcRenderer.on('download-progress', (event, prog) => {
  dlProgressFill.style.width = `${prog.percent}%`;
  dlStatusPercent.textContent = `${prog.percent}%`;
  dlMetricSpeed.textContent = prog.speed;
  dlMetricDownloaded.textContent = `${prog.received} / ${prog.total}`;
  dlMetricEta.textContent = `ETA: ${prog.eta}`;
});

btnCancelDl.addEventListener('click', async () => {
  await ipcRenderer.invoke('cancel-download');
  downloadProgressContainer.classList.add('hidden');
  btnCancelDl.classList.add('hidden');
  appendLog('ISO download canceled by user.');
});

btnCloseDownloader.addEventListener('click', () => modalDownloader.classList.add('hidden'));
btnDismissDownloader.addEventListener('click', () => modalDownloader.classList.add('hidden'));

// Log Window
btnToggleLog.addEventListener('click', () => {
  modalLog.classList.remove('hidden');
});
btnCloseLog.addEventListener('click', () => modalLog.classList.add('hidden'));
btnDismissLog.addEventListener('click', () => modalLog.classList.add('hidden'));
btnClearLog.addEventListener('click', () => {
  logs = [];
  logTextarea.value = '';
});
btnCopyLog.addEventListener('click', () => {
  navigator.clipboard.writeText(logTextarea.value);
  btnCopyLog.textContent = 'Copied!';
  setTimeout(() => btnCopyLog.textContent = 'Copy Log', 1500);
});

// Settings Modal
btnSettingsTool.addEventListener('click', () => modalSettings.classList.remove('hidden'));
btnCloseSettings.addEventListener('click', () => modalSettings.classList.add('hidden'));
btnDismissSettings.addEventListener('click', () => modalSettings.classList.add('hidden'));

// About Modal
btnAboutTool.addEventListener('click', () => modalAbout.classList.remove('hidden'));
btnCloseAbout.addEventListener('click', () => modalAbout.classList.add('hidden'));
btnDismissAbout.addEventListener('click', () => modalAbout.classList.add('hidden'));

// Global keyboard & overlay click modal dismiss
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.add('hidden');
    }
  });
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(modal => {
      modal.classList.add('hidden');
    });
  }
});

// IPC Log messages
ipcRenderer.on('write-log', (event, msg) => {
  appendLog(msg);
});

// Start Operation Workflow
btnStart.addEventListener('click', () => {
  if (isOperating) {
    showNotice('An operation is already in progress.', '⏳');
    return;
  }

  if (!selectedDrive) {
    showNotice('No target device selected. Please connect a USB flash drive or use the Virtual Demo USB disk.', '⚠️');
    return;
  }

  const bootMode = selectBoot.value;
  if (bootMode === 'iso' && !selectedIsoInfo) {
    showNotice('Please select an ISO or disk image by clicking SELECT, or click DOWNLOAD to choose an official OS image, or change Boot Selection to "Non-bootable" to format the drive.', 'ℹ️');
    return;
  }

  // If Windows ISO, show Windows Experience customization modal first!
  if (bootMode === 'iso' && selectedIsoInfo && selectedIsoInfo.isWindows) {
    modalWindowsTweaks.classList.remove('hidden');
  } else {
    promptConfirmation();
  }
});

function promptConfirmation() {
  confirmDeviceMsg.textContent = `WARNING: ALL DATA ON DEVICE '${selectedDrive.displayName}' WILL BE DESTROYED.\nTo continue with this operation, click OK. To quit click CANCEL.`;
  modalConfirm.classList.remove('hidden');
}

btnConfirmCancel.addEventListener('click', () => {
  modalConfirm.classList.add('hidden');
  appendLog('Operation cancelled by user.');
});

btnConfirmOk.addEventListener('click', async () => {
  modalConfirm.classList.add('hidden');
  executeOperation();
});

async function executeOperation() {
  isOperating = true;
  btnStart.disabled = true;
  btnSelectIso.disabled = true;
  btnRefreshDrives.disabled = true;
  selectDevice.disabled = true;
  statusLabel.textContent = 'Starting...';
  progressBarFill.style.width = '0%';
  statusPercentage.textContent = '0%';
  metricSpeed.textContent = '0.0 MB/s';
  metricEta.textContent = 'ETA: --:--:--';
  metricElapsed.textContent = 'Elapsed: 00:00:00';

  const bootMode = selectBoot.value;

  try {
    if (bootMode === 'iso' && selectedIsoInfo) {
      appendLog(`Starting write of image ${selectedIsoInfo.path} to ${selectedDrive.path}`);
      await ipcRenderer.invoke('write-image', {
        imagePath: selectedIsoInfo.path,
        devicePath: selectedDrive.path,
        isVirtual: !!selectedDrive.isVirtual,
        volumeLabel: inputVolumeLabel.value,
        windowsTweaks: pendingWindowsTweaks
      });
      statusLabel.textContent = 'Ready';
      progressBarFill.style.width = '100%';
      statusPercentage.textContent = '100%';
      showNotice('Operation completed successfully! Your bootable USB drive is ready.', '✅');
    } else {
      appendLog(`Formatting device ${selectedDrive.path} with filesystem ${selectFilesystem.value} (${bootMode})`);
      await ipcRenderer.invoke('format-device', {
        devicePath: selectedDrive.path,
        partitionScheme: selectPartition.value,
        fileSystem: selectFilesystem.value,
        volumeLabel: inputVolumeLabel.value,
        isVirtual: !!selectedDrive.isVirtual,
        quickFormat: chkQuickFormat.checked,
        badBlocksCheck: chkBadBlocks.checked,
        badBlocksPasses: parseInt(selectBadBlocksPasses.value, 10) || 1
      });
      statusLabel.textContent = 'Ready';
      progressBarFill.style.width = '100%';
      statusPercentage.textContent = '100%';
      showNotice('Device formatted successfully!', '✅');
    }
  } catch (err) {
    appendLog(`Operation failed: ${err.message}`);
    statusLabel.textContent = 'Failed';
    showNotice(`Error: ${err.message}`, '❌');
  } finally {
    isOperating = false;
    btnStart.disabled = false;
    btnSelectIso.disabled = false;
    btnRefreshDrives.disabled = false;
    selectDevice.disabled = false;
    pendingWindowsTweaks = null;
  }
}

// Progress Listeners
ipcRenderer.on('write-progress', (event, prog) => {
  progressBarFill.style.width = `${prog.percent}%`;
  statusPercentage.textContent = `${prog.percent}%`;
  statusLabel.textContent = prog.statusText || 'Writing image...';
  metricSpeed.textContent = prog.speed || '0 MB/s';
  metricEta.textContent = `ETA: ${prog.eta || '--:--:--'}`;
  metricElapsed.textContent = `Elapsed: ${prog.elapsed || '00:00:00'}`;
});

ipcRenderer.on('format-progress', (event, prog) => {
  progressBarFill.style.width = `${prog.percent}%`;
  statusPercentage.textContent = `${prog.percent}%`;
  statusLabel.textContent = prog.statusText || 'Formatting...';
});

// App Close
btnClose.addEventListener('click', () => {
  ipcRenderer.invoke('close-app');
});

// Initial boot
appendLog('Rufus 4.15 for Linux initialized.');
loadDrives();
