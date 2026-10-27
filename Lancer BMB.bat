@echo off

title BMB Gestion Magasin

cd /d "%~dp0"



echo.

echo  BMB Gestion Magasin

echo  -------------------

echo.



where node >nul 2>&1

if errorlevel 1 (

  echo ERREUR : Node.js n'est pas installe.

  echo Telechargez-le sur https://nodejs.org

  pause

  exit /b 1

)



if not exist "node_modules\electron" (

  echo Installation des composants bureau ^(premiere fois^)...

  call npm install

)



if not exist "backend\node_modules" (
  echo Installation du serveur ^(premiere fois^)...
) else (
  echo Mise a jour des dependances backend...
)
cd backend && call npm install && cd ..



if not exist "frontend\node_modules" (

  echo Installation de l'interface ^(premiere fois^)...

  cd frontend && call npm install && cd ..

)



echo Liberation des ports 3001 et 5173...

call npm run stop:ports



echo.

echo Demarrage de BMB ^(serveur + interface^)...

echo Patientez 10 a 20 secondes au premier lancement.

echo.



call npm run app

if errorlevel 1 (

  echo.

  echo ERREUR au demarrage.

  echo - PostgreSQL doit etre demarre ^(base bmb_gestion^)

  echo - Sinon : npm run db:migrate puis npm run db:seed

  pause

)

