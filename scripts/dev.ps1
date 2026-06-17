# FibraNexus — desarrollo local (2 terminales en una)
$root = Split-Path $PSScriptRoot -Parent
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

if (-not (Test-Path "$root\server\.env")) {
  Write-Host "Falta server\.env — copia DATABASE_URL desde Render" -ForegroundColor Red
  exit 1
}

$db = Get-Content "$root\server\.env" | Where-Object { $_ -match '^DATABASE_URL=\S' }
if (-not $db) {
  Write-Host ""
  Write-Host "DATABASE_URL vacío — modo solo frontend (producción API)" -ForegroundColor Yellow
  Write-Host "  Para probar fixes de sync: Render → Environment → copia DATABASE_URL + JWT_SECRET a server\.env" -ForegroundColor DarkYellow
  Write-Host "  Diagnóstico: cd server; node ..\scripts\lab-detected-check.mjs" -ForegroundColor DarkYellow
  Write-Host ""
  if (-not (Test-Path "$root\client\.env.local")) {
    '# Modo B: solo UI | descomenta VITE_API_URL en .env.local para prod API' | Out-File -Encoding utf8 "$root\client\.env.local"
  }
  $envContent = Get-Content "$root\client\.env.local" -Raw
  if ($envContent -notmatch '(?m)^VITE_API_URL=') {
    Add-Content "$root\client\.env.local" "VITE_API_URL=https://app.fibranexus.cl/api"
  }
  Set-Location "$root\client"
  npm run dev
  exit 0
}

# Modo full stack: quitar VITE_API_URL para usar proxy vite → localhost:10000
$localEnv = "$root\client\.env.local"
if (Test-Path $localEnv) {
  $lines = Get-Content $localEnv | Where-Object { $_ -notmatch '^\s*VITE_API_URL=' }
  $lines | Set-Content $localEnv -Encoding utf8
}

Write-Host "Modo full stack — misma DB que producción" -ForegroundColor Green
Write-Host "  Diagnóstico CPE: cd server; node ..\scripts\lab-detected-check.mjs" -ForegroundColor DarkGray
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\server'; npm run dev"
Start-Sleep -Seconds 2
Set-Location "$root\client"
npm run dev
