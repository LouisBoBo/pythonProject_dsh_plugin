# Build + mock self-test for @zhongruan/dsh-cursor-chat (does NOT touch dsh-cursor-coding)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..\plugins\dsh-cursor-chat

Write-Host '== npm install =='
npm install --no-fund --no-audit
if ($LASTEXITCODE -ne 0) { throw "npm install failed: $LASTEXITCODE" }

Write-Host '== build =='
npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed: $LASTEXITCODE" }

Write-Host '== self-test (MOCK) =='
$env:CURSOR_CHAT_MOCK = '1'
# isolate data dir for test (self-test also sets CURSOR_CHAT_HOME)
npm run self-test
if ($LASTEXITCODE -ne 0) { throw "self-test failed: $LASTEXITCODE" }

Write-Host 'OK: cursor-chat build + self-test passed'
