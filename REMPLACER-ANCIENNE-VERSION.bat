@echo off
chcp 65001 >nul
title BMB - Remplacer l ancienne version
cd /d "%~dp0"

echo.
echo  ========================================
echo   BMB - Remplacement v1.0 par v1.2
echo  ========================================
echo.
echo  Ce script est dans le NOUVEAU dossier BMB.
echo  Il recupere les fichiers a conserver de l ancien dossier.
echo.

set /p OLD_PATH="Chemin complet de l ANCIEN dossier BMB : "

if not exist "%OLD_PATH%\backend\.env" (
  echo.
  echo ERREUR : backend\.env introuvable dans :
  echo   %OLD_PATH%
  echo.
  pause
  exit /b 1
)

echo.
echo Arret de l ancienne application...
call npm run stop:ports

echo.
echo [1/4] Copie backend\.env ...
if not exist "backend" mkdir "backend"
copy /Y "%OLD_PATH%\backend\.env" "backend\.env" >nul
if errorlevel 1 (
  echo ERREUR copie .env
  pause
  exit /b 1
)
echo       OK

echo [2/4] Copie sauvegardes backups\ ...
if exist "%OLD_PATH%\backups" (
  if not exist "backups" mkdir "backups"
  xcopy /E /I /Y "%OLD_PATH%\backups\*" "backups\" >nul
  echo       OK
) else (
  echo       — pas de dossier backups sur l ancien
)

echo [3/4] Copie logos uploads\ ...
if exist "%OLD_PATH%\backend\uploads" (
  if not exist "backend\uploads" mkdir "backend\uploads"
  xcopy /E /I /Y "%OLD_PATH%\backend\uploads\*" "backend\uploads\" >nul
  echo       OK
) else if exist "%OLD_PATH%\uploads" (
  if not exist "backend\uploads" mkdir "backend\uploads"
  xcopy /E /I /Y "%OLD_PATH%\uploads\*" "backend\uploads\" >nul
  echo       OK
) else (
  echo       — pas de dossier uploads
)

echo [4/4] Mise a jour technique...
call npm run deploy:server
if errorlevel 1 (
  echo.
  echo ERREUR pendant la mise a jour.
  pause
  exit /b 1
)

echo.
echo  ========================================
echo   Remplacement termine
echo.
echo   1. Renommez ou supprimez l ancien dossier :
echo      %OLD_PATH%
echo   2. Deplacez CE dossier a la place si besoin
echo   3. Lancez : Lancer BMB Web.bat
echo   4. Sur chaque PC : Ctrl+F5
echo  ========================================
echo.
pause
