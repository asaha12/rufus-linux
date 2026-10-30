/**
 * Generates an autounattend.xml file matching Rufus Windows User Experience tweaks
 * @param {Object} options
 * @param {boolean} options.bypassTpm
 * @param {boolean} options.bypassAccount
 * @param {boolean} options.createLocalUser
 * @param {string} options.username
 * @param {boolean} options.regional
 * @param {boolean} options.privacy
 * @param {boolean} options.bitlocker
 * @returns {string} XML content
 */
function generateAutounattendXml(options = {}) {
  const {
    bypassTpm = true,
    bypassAccount = true,
    createLocalUser = true,
    username = 'User',
    regional = true,
    privacy = true,
    bitlocker = true
  } = options;

  let runSynchronousCommands = [];
  let orderIndex = 1;

  if (bypassTpm) {
    runSynchronousCommands.push(`
        <RunSynchronousCommand wcm:action="add">
          <Order>${orderIndex++}</Order>
          <Description>Bypass TPM / SecureBoot / RAM Check</Description>
          <Path>cmd /c reg add "HKLM\\SYSTEM\\Setup\\LabConfig" /v "BypassTPMCheck" /t REG_DWORD /d 1 /f &amp; reg add "HKLM\\SYSTEM\\Setup\\LabConfig" /v "BypassSecureBootCheck" /t REG_DWORD /d 1 /f &amp; reg add "HKLM\\SYSTEM\\Setup\\LabConfig" /v "BypassRAMCheck" /t REG_DWORD /d 1 /f &amp; reg add "HKLM\\SYSTEM\\Setup\\LabConfig" /v "BypassCPUCheck" /t REG_DWORD /d 1 /f &amp; reg add "HKLM\\SYSTEM\\Setup\\LabConfig" /v "BypassStorageCheck" /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>`);
  }

  if (bitlocker) {
    runSynchronousCommands.push(`
        <RunSynchronousCommand wcm:action="add">
          <Order>${orderIndex++}</Order>
          <Description>Disable BitLocker Automatic Encryption</Description>
          <Path>cmd /c reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\BitLocker" /v "PreventDeviceEncryption" /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>`);
  }

  let userAccountXml = '';
  if (createLocalUser && username) {
    userAccountXml = `
      <UserAccounts>
        <LocalAccounts>
          <LocalAccount wcm:action="add">
            <Description>Local Account created by Rufus</Description>
            <DisplayName>${escapeXml(username)}</DisplayName>
            <Group>Administrators</Group>
            <Name>${escapeXml(username)}</Name>
            <Password>
              <Value></Value>
              <PlainText>true</PlainText>
            </Password>
          </LocalAccount>
        </LocalAccounts>
      </UserAccounts>`;
  }

  let oobeXml = '';
  if (bypassAccount || privacy) {
    oobeXml = `
      <OOBE>
        ${privacy ? '<ProtectYourPC>3</ProtectYourPC>' : ''}
        ${bypassAccount ? '<HideOnlineAccountScreens>true</HideOnlineAccountScreens>' : ''}
        <HideWirelessSetupInOOBE>false</HideWirelessSetupInOOBE>
        <HideEULAPage>true</HideEULAPage>
      </OOBE>`;
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="windowsPE">
    <component name="Microsoft-Windows-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <RunSynchronous>
        ${runSynchronousCommands.join('\n')}
      </RunSynchronous>
      <UserData>
        <AcceptEula>true</AcceptEula>
      </UserData>
    </component>
  </settings>
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      ${oobeXml}
      ${userAccountXml}
    </component>
  </settings>
</unattend>`.trim();
}

function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

module.exports = { generateAutounattendXml };
