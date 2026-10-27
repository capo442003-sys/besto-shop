@echo off

title BMB Gestion — Mode developpement

cd /d "%~dp0"

echo.
echo  BMB — Mode DEVELOPPEMENT
echo  ------------------------
echo  - Interface : http://localhost:5173 (rechargement auto)
echo  - API       : http://localhost:3001
echo  - PWA desactivee en dev (normal)
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERREUR : Node.js n'est pas installe.
  pause
  exit /b 1
)

call npm run stop:ports
call npm run app:dev

pause
