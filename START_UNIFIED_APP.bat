@echo off
title KAAPAAN + Ambulancy Unified System
cd /d "%~dp0"
echo ====================================================================
echo Starting Unified KAAPAAN + Ambulancy Fullstack System
echo ====================================================================

echo [1/2] Starting Node.js Backend Server on port 5000...
start "KAAPAAN-Backend" cmd /k "node server\server.js"

echo [2/2] Starting React Vite Frontend on port 3000...
start "KAAPAAN-Frontend" cmd /k "npm --prefix client run dev"

echo ====================================================================
echo Both servers started!
echo Open your browser at: http://localhost:3000
echo ====================================================================
pause
