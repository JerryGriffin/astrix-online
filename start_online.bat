@echo off
title Astrix Online Server + Cloudflare Tunnel
if exist "%~dp0node.exe" (
    set "PATH=%~dp0;%PATH%"
    goto :node_found
)
where node >nul 2>nul
if %errorlevel% neq 0 (
    if exist "C:\Users\zhang\Downloads\node.exe" set "PATH=C:\Users\zhang\Downloads;%PATH%"
    if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
    if exist "%LOCALAPPDATA%\Programs\node\node.exe" set "PATH=%LOCALAPPDATA%\Programs\node;%PATH%"
    for /d %%D in ("%USERPROFILE%\*node*") do (
        if exist "%%D\node.exe" set "PATH=%%D;%PATH%"
    )
    for /r "%USERPROFILE%" %%F in (node.exe) do (
        set "PATH=%%~dpF;%PATH%"
        goto :node_found
    )
)
:node_found
echo ========================================================
echo  Starting Astrix Online Server ^& Cloudflare Tunnel...
echo ========================================================

start "Astrix Game Server" node server.mjs
timeout /t 2 >nul
start "Cloudflare Tunnel" "C:\Users\zhang\Downloads\cloudflared.exe" tunnel --url http://localhost:8080

echo.
echo Server is running on http://localhost:8080
echo Check the Cloudflare window for your public HTTPS link!
echo ========================================================
pause
