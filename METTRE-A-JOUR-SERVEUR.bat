@echo off
title BMB - Mise a jour serveur
cd /d "%~dp0"

echo.
echo  ========================================
echo   BMB Gestion - Mise a jour serveur
echo  ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERREUR : Node.js requis - https://nodejs.org
  pause
  exit /b 1
)

if not exist "backend\.env" (
  echo.
  echo ERREUR : backend\.env introuvable
  echo Conservez le fichier .env de l ancienne installation
  echo.
  pause
  exit /b 1
)

echo Sauvegarde recommandee : npm run backup:db
echo.
pause

echo Arret des anciens processus...
call npm run stop:ports

echo.
echo Mise a jour en cours...
call npm run deploy:server

if errorlevel 1 (
  echo.
  echo ERREUR pendant la mise a jour.
  pause
  exit /b 1
)

echo.
echo ========================================
echo  Mise a jour terminee
echo  Lancez : Lancer BMB Web.bat ou Lancer BMB.bat
echo ========================================
echo.
pause
