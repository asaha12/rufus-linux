const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { getDrives } = require('./drive-manager');
const { parseIsoInfo } = require('./iso-parser');
const { calculateHashes, writeImage, formatDevice } = require('./writer-backend');
const { getAvailableDownloads, startDownload, cancelDownload } = require('./downloader');

// Ensure no-sandbox on Linux systems to prevent permission/namespace errors
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 630,
    minWidth: 400,
    minHeight: 580,
    resizable: true,
    title: 'Rufus 4.15 for Linux (Portable)',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handler: Fetch drives
ipcMain.handle('get-drives', async (event, options) => {
  return await getDrives(options);
});

// IPC Handler: File chooser
ipcMain.handle('open-file-dialog', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Disk or ISO Image',
      properties: ['openFile'],
      filters: [
        { name: 'Bootable ISO / Disk Images', extensions: ['iso', 'img', 'vhd', 'vhdx', 'raw', 'bin', 'gz', 'xz', 'zst'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    const isoInfo = await parseIsoInfo(filePath);
    return isoInfo;
  } catch (err) {
    console.error('File dialog error:', err);
    return null;
  }
});

// IPC Handler: Parse ISO directly
ipcMain.handle('parse-iso', async (event, filePath) => {
  return await parseIsoInfo(filePath);
});

// IPC Handler: Calculate Hashes
ipcMain.handle('calculate-hashes', async (event, filePath) => {
  return await calculateHashes(filePath, (percent) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('hash-progress', percent);
    }
  });
});

// IPC Handler: Write Image
ipcMain.handle('write-image', async (event, params) => {
  return await writeImage(
    params,
    (progressData) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('write-progress', progressData);
      }
    },
    (logMsg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('write-log', logMsg);
      }
    }
  );
});

// IPC Handler: Format Device
ipcMain.handle('format-device', async (event, params) => {
  return await formatDevice(
    params,
    (progressData) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('format-progress', progressData);
      }
    },
    (logMsg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('write-log', logMsg);
      }
    }
  );
});

// IPC Handler: Downloads
ipcMain.handle('get-downloads', async () => {
  return getAvailableDownloads();
});

ipcMain.handle('start-download', async (event, isoId) => {
  return await startDownload(
    isoId,
    (progressData) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', progressData);
      }
    },
    (logMsg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('write-log', logMsg);
      }
    }
  );
});

ipcMain.handle('cancel-download', async () => {
  cancelDownload();
  return true;
});

// IPC Handler: External URLs (Safe protocol check)
ipcMain.handle('open-url', async (event, url) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
    return true;
  }
  return false;
});

// IPC Handler: Exit
ipcMain.handle('close-app', () => {
  app.quit();
});
