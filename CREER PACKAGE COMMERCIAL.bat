@echo off
chcp 65001 >nul
title BMB — Package commercial

cd /d "%~dp0"

echo.
echo  Creation du dossier de livraison client...
echo  (compilation + copie dans dist\BMB-Gestion-1.0.0)
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERREUR : Node.js requis.
  pause
  exit /b 1
)

call npm run release

echo.
echo  Livrez le dossier dist\BMB-Gestion-1.0.0 au client
echo  avec INSTALLER BMB.bat et LIRE-MOI.txt
echo.
pause
