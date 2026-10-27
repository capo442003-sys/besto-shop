@echo off
chcp 65001 >nul
title BMB — Installation client

cd /d "%~dp0"

echo.
echo  ══════════════════════════════════════════
echo   BMB GESTION MAGASIN — Installation v1.0.0
echo  ══════════════════════════════════════════
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] Node.js n'est pas installe.
  echo Telechargez Node.js 20 LTS : https://nodejs.org
  pause
  exit /b 1
)

where psql >nul 2>&1
if errorlevel 1 (
  echo [ATTENTION] PostgreSQL (psql) non detecte dans le PATH.
  echo Installez PostgreSQL et creez la base "bmb_gestion" avant de continuer.
  echo.
  pause
)

echo [1/6] Installation des dependances...
call npm run install:all
if errorlevel 1 goto :fail

if not exist "backend\.env" (
  echo [2/6] Creation du fichier backend\.env ...
  copy /Y "backend\.env.example" "backend\.env" >nul
  echo        IMPORTANT : editez backend\.env (PostgreSQL + JWT_SECRET)
) else (
  echo [2/6] Fichier backend\.env deja present — conserve
)

echo [3/6] Migration base de donnees...
call npm run db:migrate
if errorlevel 1 goto :fail

echo [4/6] Donnees initiales (admin, categories, points de vente)...
call npm run db:seed
if errorlevel 1 goto :fail

echo [5/6] Compilation interface (production)...
cd frontend
call npm run build
cd ..
if errorlevel 1 goto :fail

echo [6/6] Verification...
call npm run test:api
if errorlevel 1 (
  echo [ATTENTION] Tests API echoues — verifiez que PostgreSQL tourne.
)

echo.
echo  ══════════════════════════════════════════
echo   Installation terminee.
echo.
echo   Prochaines etapes :
echo   1. Editez backend\.env (securite)
echo   2. Lancez Lancer BMB.bat
echo   3. Connectez-vous : admin / admin123
echo   4. Changez le mot de passe admin
echo  ══════════════════════════════════════════
echo.
pause
exit /b 0

:fail
echo.
echo [ERREUR] Installation interrompue.
pause
exit /b 1
