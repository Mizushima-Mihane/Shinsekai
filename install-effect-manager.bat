@echo off
cd /d "%~dp0"

echo.
echo   ============================================
echo     Shinsekai Effect Manager Installer
echo   ============================================
echo.

if not exist "effect-manager-update.zip" (
    echo [ERROR] Cannot find effect-manager-update.zip
    echo Please put both files in the Shinsekai folder.
    pause
    exit /b 1
)

echo [1/3] Backing up frontend/dist ...
if exist "frontend\dist" (
    mkdir "effect-manager-backup\frontend\dist" 2>nul
    xcopy /e /i /q /y "frontend\dist" "effect-manager-backup\frontend\dist" >nul
)

echo [2/3] Cleaning old dist files ...
if exist "frontend\dist" rmdir /s /q "frontend\dist"

echo [3/3] Extracting and installing ...
powershell -Command "Expand-Archive -Path 'effect-manager-update.zip' -DestinationPath '%CD%' -Force"

if %errorlevel% neq 0 (
    echo [ERROR] Extraction failed. Try extracting the zip manually.
    pause
    exit /b 1
)

echo.
echo   ============================================
echo     Done! Restart Shinsekai to try it out.
echo     To revert, copy files back from:
echo       effect-manager-backup\
echo   ============================================
echo.
pause
