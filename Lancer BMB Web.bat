@echo off
title BMB Gestion Magasin - Mode Web
cd /d "%~dp0"

echo.
echo  BMB Gestion Magasin - Serveur Web
echo  --------------------------------
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERREUR : Node.js n'est pas installe.
  echo Telechargez-le sur https://nodejs.org
  pause
  exit /b 1
)

if not exist "backend\.env" (
  echo ERREUR : Creez backend\.env a partir de backend\.env.example
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installation des outils racine...
  call npm install
)

if not exist "frontend\dist\index.html" (
  echo Compilation de l interface...
  cd frontend && call npm install --include=dev && call npm run build && cd ..
  if errorlevel 1 (
    echo ERREUR : echec compilation frontend
    pause
    exit /b 1
  )
)

if not exist "backend\node_modules" (
  echo Installation du serveur...
) else (
  echo Mise a jour des dependances backend...
)
cd backend && call npm install && cd ..
if errorlevel 1 (
  echo ERREUR : echec installation backend
  pause
  exit /b 1
)

echo Migrations base de donnees...
cd backend
call npm run db:migrate
if errorlevel 1 (
  echo ATTENTION : migrations en echec — verifiez PostgreSQL et backend\.env
)
cd ..

echo Verification PostgreSQL...
cd backend
node scripts/preflight.js
if errorlevel 1 (
  echo.
  echo PostgreSQL inaccessible — corrigez backend\.env puis relancez.
  echo Le serveur demarrera quand meme mais la connexion echouera.
  echo.
  pause
)
cd ..

echo Liberation du port 3001...
call npm run stop:ports

echo.
echo Demarrage sur http://localhost:3001
echo NE FERMEZ PAS cette fenetre tant que BMB est utilise.
echo.

set SERVE_CLIENT=1
set NODE_ENV=production
set CLIENT_URL=http://localhost:3001

cd backend
call npm start
if errorlevel 1 (
  echo.
  echo ERREUR : le serveur ne s est pas lance.
  echo Verifiez les messages ci-dessus.
  pause
  exit /b 1
)
