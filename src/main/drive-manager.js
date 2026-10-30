const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Discovers and parses storage drives on Ubuntu/Linux
 * @param {Object} options
 * @param {boolean} options.listAllDisks - whether to include internal fixed drives
 * @returns {Promise<Array<Object>>}
 */
async function getDrives(options = { listAllDisks: false }) {
  try {
    const { stdout } = await execPromise(
      'lsblk -J -b -o NAME,PATH,SIZE,ROTA,TYPE,MOUNTPOINT,VENDOR,MODEL,HOTPLUG,TRAN,SERIAL,LABEL,FSTYPE'
    );

    const parsed = JSON.parse(stdout);
    const blockdevices = parsed.blockdevices || [];
    const drives = [];

    const criticalMounts = ['/', '/boot', '/boot/efi', '/home', '/var', '/usr', '/etc'];

    // Recursive helper to check if any child/descendant partition is a critical system mount
    function checkSystemMountsRecursive(device) {
      let isSystem = false;
      const mounts = [];

      if (device.mountpoint) {
        mounts.push(device.mountpoint);
        if (criticalMounts.includes(device.mountpoint)) {
          isSystem = true;
        }
      }

      if (device.children && Array.isArray(device.children)) {
        for (const child of device.children) {
          const childRes = checkSystemMountsRecursive(child);
          mounts.push(...childRes.mounts);
          if (childRes.isSystem) {
            isSystem = true;
          }
        }
      }

      return { isSystem, mounts };
    }

    for (const dev of blockdevices) {
      // Ignore loop devices unless virtual demo
      if (dev.type === 'loop') continue;
      // We only care about disk devices
      if (dev.type !== 'disk') continue;

      const { isSystem, mounts } = checkSystemMountsRecursive(dev);
      const isUsb = dev.tran === 'usb' || dev.hotplug === true;
      const sizeBytes = parseInt(dev.size, 10) || 0;
      const sizeGB = (sizeBytes / (1024 * 1024 * 1024)).toFixed(1);

      // Model & Vendor cleanup
      const vendor = (dev.vendor || '').trim();
      const model = (dev.model || '').trim();
      let displayName = `${vendor} ${model}`.trim();
      if (!displayName) {
        displayName = dev.name;
      }

      // Collect partition labels or filesystem info
      let fsInfo = '';
      if (dev.children && dev.children.length > 0) {
        const labels = [];
        function collectLabels(node) {
          if (node.label) labels.push(node.label);
          else if (node.fstype) labels.push(node.fstype);
          if (node.children) node.children.forEach(collectLabels);
        }
        dev.children.forEach(collectLabels);
        if (labels.length > 0) {
          fsInfo = `[${labels.slice(0, 3).join(', ')}]`;
        }
      }

      const driveObj = {
        name: dev.name,
        path: dev.path,
        size: sizeBytes,
        formattedSize: `${sizeGB} GB`,
        vendor: vendor,
        model: model,
        tran: dev.tran,
        isUsb: isUsb,
        isSystem: isSystem,
        mountpoints: mounts,
        displayName: `${displayName} (${sizeGB} GB) [${dev.path}] ${fsInfo}`.trim(),
        warning: isSystem ? 'SYSTEM DRIVE (CONTAINS ROOT OR BOOT PARTITION)' : null
      };

      // Filter: if listAllDisks is false, only show USB/removable drives
      if (isUsb || options.listAllDisks) {
        drives.push(driveObj);
      }
    }

    // Always provide a Virtual Safe Test Disk option if no USB drives are plugged in
    if (drives.filter(d => !d.isSystem).length === 0) {
      drives.unshift({
        name: 'virtual-demo',
        path: '/tmp/rufus_virtual_drive.img',
        size: 8 * 1024 * 1024 * 1024,
        formattedSize: '8.0 GB',
        vendor: 'Virtual',
        model: 'Demo USB Disk (Safe Test)',
        tran: 'virtual',
        isUsb: true,
        isSystem: false,
        isVirtual: true,
        mountpoints: [],
        displayName: 'Virtual Demo USB Flash Drive (8.0 GB) [/tmp/rufus_virtual_drive.img] (Safe for Testing)',
        warning: null
      });
    }

    return drives;
  } catch (err) {
    console.error('Error fetching drives:', err);
    return [
      {
        name: 'virtual-demo',
        path: '/tmp/rufus_virtual_drive.img',
        size: 8 * 1024 * 1024 * 1024,
        formattedSize: '8.0 GB',
        vendor: 'Virtual',
        model: 'Demo USB Disk (Safe Test)',
        tran: 'virtual',
        isUsb: true,
        isSystem: false,
        isVirtual: true,
        mountpoints: [],
        displayName: 'Virtual Demo USB Flash Drive (8.0 GB) [/tmp/rufus_virtual_drive.img] (Safe for Testing)',
        warning: null
      }
    ];
  }
}

module.exports = { getDrives };
