@echo off
title Astrix Online Server + Cloudflare Tunnel
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
