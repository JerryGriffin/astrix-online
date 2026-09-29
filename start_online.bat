@echo off
title Astrix 在线联机服务器
cd /d "%~dp0"
if exist "%~dp0node.exe" (
    "%~dp0node.exe" launch.mjs
) else (
    node launch.mjs
)
pause
