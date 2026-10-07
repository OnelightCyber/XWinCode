param(
  [switch]$Yes,
  [switch]$SkipWindowsToolchain,
  [switch]$SkipIos,
  [switch]$SkipApp,
  [string]$Distro = "Ubuntu-24.04",
  [string]$Xip = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$env:WSL_UTF8 = "1"
$Repo = "OnelightCyber/XWinCode"
$RawScript = "https://raw.githubusercontent.com/$Repo/main/scripts/install.ps1"

function Step([string]$Text) { Write-Host ""; Write-Host "==> $Text" -ForegroundColor Cyan }
function Ok([string]$Text) { Write-Host "    [ok] $Text" -ForegroundColor Green }
function Info([string]$Text) { Write-Host "    $Text" -ForegroundColor Gray }
function Warn([string]$Text) { Write-Host "    [!] $Text" -ForegroundColor Yellow }

function Ask([string]$Question, [bool]$Default = $true) {
  if ($Yes) { return $Default }
  $hint = if ($Default) { "[Y/n]" } else { "[y/N]" }
  $answer = Read-Host "    $Question $hint"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
  return $answer.Trim().ToLower().StartsWith("y")
}

function Run([string]$File, [string]$Arguments) {
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -NoNewWindow -Wait -PassThru
  return $process.ExitCode
}

function Test-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  return ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Restart-Elevated {
  $file = $PSCommandPath
  if (-not $file) {
    $file = Join-Path $env:TEMP "xwincode-install.ps1"
    Invoke-WebRequest -UseBasicParsing $RawScript -OutFile $file
  }
  $arguments = "-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$file`" -Distro $Distro -SkipApp"
  if ($Yes) { $arguments += " -Yes" }
  if ($SkipWindowsToolchain) { $arguments += " -SkipWindowsToolchain" }
  if ($SkipIos) { $arguments += " -SkipIos" }
  if ($Xip) { $arguments += " -Xip `"$Xip`"" }
  Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments
}

function Winget([string]$Arguments) {
  return Run "winget" "$Arguments --accept-package-agreements --accept-source-agreements --disable-interactivity"
}

function Get-Distros {
  $list = & wsl.exe --list --quiet 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $list) { return @() }
  return @($list | ForEach-Object { ($_ -replace "`0", "").Trim() } | Where-Object { $_ })
}

function Invoke-WslScript([string]$Script, [switch]$AsRoot) {
  $dir = Join-Path $env:TEMP "xwincode-setup"
  New-Item -ItemType Directory -Force $dir | Out-Null
  $name = "step-$([guid]::NewGuid().ToString('N')).sh"
  [IO.File]::WriteAllText((Join-Path $dir $name), $Script.Replace("`r`n", "`n"))
  $user = if ($AsRoot) { "-u root " } else { "" }
  $code = Run "wsl.exe" "-d $Distro $user--cd `"$dir`" -e bash ./$name"
  Remove-Item (Join-Path $dir $name) -ErrorAction SilentlyContinue
  return $code
}

function Invoke-WslLogin([string]$Command) {
  return Run "wsl.exe" "-d $Distro -e bash -lc `"$Command`""
}

function Read-Wsl([string]$Command) {
  return (& wsl.exe -d $Distro -e bash -lc $Command 2>$null | Out-String).Trim()
}

function Install-App {
  Step "XWinCode"
  try {
    $release = Invoke-RestMethod -UseBasicParsing "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "xwincode-install" }
    $asset = $release.assets | Where-Object { $_.name -like "*-setup.exe" } | Select-Object -First 1
    if (-not $asset) { throw "no installer in the latest release" }
    $installer = Join-Path $env:TEMP $asset.name
    Info "Downloading $($asset.name)..."
    Invoke-WebRequest -UseBasicParsing $asset.browser_download_url -OutFile $installer
    if ($asset.digest) {
      $expected = ($asset.digest -replace "^sha256:", "").ToUpperInvariant()
      if ((Get-FileHash $installer -Algorithm SHA256).Hash -ne $expected) {
        Remove-Item $installer -Force -ErrorAction SilentlyContinue
        throw "the download does not match the SHA-256 published by GitHub"
      }
      Ok "SHA-256 checked"
    }
    Start-Process $installer -ArgumentList "/S" -Wait
    Remove-Item $installer -Force -ErrorAction SilentlyContinue
    Ok "XWinCode $($release.tag_name) installed, shortcut added to the desktop"
  } catch {
    Warn "XWinCode was not installed ($($_.Exception.Message))."
    Info "Build it from source instead: npm install, then npm run tauri build"
  }
}

if (-not (Test-Admin)) {
  if (-not $SkipApp) { Install-App }
  if ($SkipWindowsToolchain -and $SkipIos) { exit 0 }
  Write-Host "XWinCode setup needs administrator rights (WSL, Visual Studio Build Tools). Asking Windows..." -ForegroundColor Cyan
  Restart-Elevated
  exit
}

Write-Host ""
Write-Host "  XWinCode setup" -ForegroundColor White
Write-Host "  Swift on Windows, apps on iPhone. Safe to run again: finished steps are skipped." -ForegroundColor Gray

$build = [Environment]::OSVersion.Version.Build
if ($build -lt 19041) {
  Warn "Windows build $build is too old for WSL 2 (19041 or later is needed). Update Windows first."
  exit 1
}

Step "winget"
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Warn "winget is missing: install 'App Installer' from the Microsoft Store, then run this script again."
  Start-Process "ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1"
  exit 1
}
Ok "winget is available"

if (-not $SkipWindowsToolchain) {
  Step "Swift for Windows (to build Windows programs)"
  if (Get-Command swift -ErrorAction SilentlyContinue) {
    Ok "Swift is already installed"
  } elseif (Ask "Install Swift for Windows and the Visual Studio C++ Build Tools (about 4 GB)?" $true) {
    $vs = Winget "install --id Microsoft.VisualStudio.2022.BuildTools --exact --override `"--wait --passive --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.22621`""
    if ($vs -ne 0) { Warn "Visual Studio Build Tools exited with code $vs" }
    $swift = Winget "install --id Swift.Toolchain --exact"
    if ($swift -eq 0) { Ok "Swift for Windows installed" } else { Warn "Swift for Windows exited with code $swift" }
  } else {
    Info "Skipped"
  }
}

if (-not $SkipIos) {
  Step "Apple Devices (iPhone USB driver)"
  $service = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "Apple Mobile Device*" -or $_.DisplayName -like "Apple Mobile Device*" }
  if ($service) {
    Ok "Apple Mobile Device service found"
  } else {
    $code = Winget "install --id 9NP83LWLPZ9K --source msstore"
    if ($code -eq 0) {
      Ok "Apple Devices installed"
    } else {
      Warn "Install Apple Devices from the Microsoft Store (winget code $code)"
      Start-Process "ms-windows-store://pdp/?ProductId=9NP83LWLPZ9K"
    }
  }

  Step "WSL"
  & wsl.exe --status *> $null
  if ($LASTEXITCODE -eq 0) {
    Ok "WSL is enabled"
  } else {
    Info "Enabling WSL..."
    Run "wsl.exe" "--install --no-distribution" | Out-Null
    & wsl.exe --status *> $null
    if ($LASTEXITCODE -ne 0) {
      Warn "Restart Windows to finish enabling WSL, then run this script again."
      exit 0
    }
    Ok "WSL enabled"
  }

  Step "$Distro"
  if ((Get-Distros) -contains $Distro) {
    Ok "$Distro is installed"
  } else {
    $target = Get-Volume | Where-Object { $_.DriveType -eq "Fixed" -and $_.DriveLetter } | Sort-Object SizeRemaining -Descending | Select-Object -First 1
    $location = "$($target.DriveLetter):\WSL\$Distro"
    New-Item -ItemType Directory -Force (Split-Path $location) | Out-Null
    Info "Installing $Distro in $location (the drive with the most free space)."
    Write-Host ""
    Write-Host "    Ubuntu will ask you to create a Linux user name and password." -ForegroundColor White
    Write-Host "    When you see a Linux prompt ending with $, type: exit" -ForegroundColor White
    Write-Host ""
    $code = Run "wsl.exe" "--install -d $Distro --location `"$location`""
    if ($code -ne 0 -and -not ((Get-Distros) -contains $Distro)) {
      Run "wsl.exe" "--install -d $Distro" | Out-Null
    }
    if (-not ((Get-Distros) -contains $Distro)) {
      Warn "$Distro is not ready yet. Finish its setup (or restart Windows), then run this script again."
      exit 1
    }
    Ok "$Distro installed"
  }

  $user = (& wsl.exe -d $Distro -e bash -c "getent passwd 1000 | cut -d: -f1" 2>$null | Out-String).Trim()
  if (-not $user) {
    Warn "No Linux user in $Distro. Open it once from the Start menu to create one, then run this script again."
    exit 1
  }
  Ok "Linux user: $user"

  Step "System packages in WSL"
  $packages = @'
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q --no-install-recommends ca-certificates curl binutils git gnupg2 libc6-dev \
  libcurl4-openssl-dev libedit2 libncurses-dev libpython3-dev libsqlite3-0 libxml2-dev libz3-dev \
  pkg-config tzdata unzip zip zlib1g-dev socat libimobiledevice-utils ideviceinstaller
apt-get install -y -q --no-install-recommends libgcc-13-dev libstdc++-13-dev 2>/dev/null || true
apt-get install -y -q libfuse2t64 2>/dev/null || apt-get install -y -q libfuse2
'@
  if ((Invoke-WslScript $packages -AsRoot) -eq 0) { Ok "Packages installed" } else { Warn "apt failed: check your internet connection and run the script again"; exit 1 }

  Step "Swift for Linux (swiftly)"
  if ((Invoke-WslLogin "command -v swift >/dev/null 2>&1") -eq 0) {
    Ok "Swift for Linux is installed"
  } else {
    $swiftly = @'
set -e
cd ~
curl -fsSLO "https://download.swift.org/swiftly/linux/swiftly-$(uname -m).tar.gz"
tar zxf "swiftly-$(uname -m).tar.gz"
./swiftly init --quiet-shell-followup --assume-yes
. "${SWIFTLY_HOME_DIR:-$HOME/.local/share/swiftly}/env.sh"
swift --version
'@
    if ((Invoke-WslScript $swiftly) -eq 0) { Ok "Swift for Linux installed" } else { Warn "swiftly failed"; exit 1 }
  }

  Step "xtool"
  $xtool = @'
set -e
mkdir -p ~/.local/bin
curl -fsSL -o ~/.local/bin/xtool "https://github.com/xtool-org/xtool/releases/latest/download/xtool-$(uname -m).AppImage"
chmod +x ~/.local/bin/xtool
~/.local/bin/xtool --version
'@
  if ((Invoke-WslScript $xtool) -eq 0) { Ok "xtool is up to date" } else { Warn "xtool download failed"; exit 1 }

  Step "iOS SDK (from Xcode.xip)"
  if ((Read-Wsl "xtool sdk status 2>&1 | head -1") -match "is installed") {
    Ok "The iOS SDK is installed"
  } else {
    Info "Apple only lets you download Xcode.xip with your own Apple ID (free):"
    Info "https://developer.apple.com/download/all/?q=Xcode"
    $path = $Xip
    if (-not $path -and -not $Yes) {
      if (Ask "Open the download page now?" $true) { Start-Process "https://developer.apple.com/download/all/?q=Xcode" }
      $path = (Read-Host "    Path to Xcode.xip (drag the file here), or Enter to do it later from XWinCode").Trim('"', ' ')
    }
    if ($path -and (Test-Path $path)) {
      $wslPath = (& wsl.exe -d $Distro -e wslpath -a -u ($path -replace "\\", "/") | Out-String).Trim()
      $quoted = $wslPath -replace "'", "'\''"
      if ((Invoke-WslLogin "xtool sdk install '$quoted'") -eq 0) { Ok "iOS SDK installed" } else { Warn "xtool sdk install failed" }
    } else {
      Info "Later: XWinCode > Settings > Tools & SDKs > iOS SDK > Choose Xcode.xip"
    }
  }

  Step "Apple ID (signing)"
  if ((Read-Wsl "xtool auth status 2>&1 | head -1") -match "Logged in") {
    Ok "Signed in"
  } elseif (-not $Yes -and (Ask "Sign in with your Apple ID now? (typed into xtool, never stored by this script)" $true)) {
    Info "Choose 'Password' if you don't have a paid developer account."
    Invoke-WslLogin "xtool auth login" | Out-Null
  } else {
    Info "Later: XWinCode > Settings > iPhone & WSL > Apple account > Sign in"
  }
}

if (-not $SkipApp) { Install-App }

Step "Done"
Info "On the iPhone: plug it in, tap 'Trust This Computer', then turn on"
Info "Settings > Privacy & Security > Developer Mode (it appears after the first install)."
Info "Open XWinCode: the welcome screen shows what is ready."
Write-Host ""
