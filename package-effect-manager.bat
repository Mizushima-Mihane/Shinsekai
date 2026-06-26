@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

REM ============================================
REM  开发端：打包特效管理系统更新包
REM  在 feature/effect-manager 分支下运行
REM ============================================

cd /d "%~dp0"

echo.
echo   ============================================
echo     特效管理系统 — 打包更新包
echo   ============================================
echo.

REM 检查是否在 feature/effect-manager 分支
for /f "tokens=*" %%i in ('git branch --show-current') do set "BRANCH=%%i"
if not "%BRANCH%"=="feature/effect-manager" (
    echo [错误] 请在 feature/effect-manager 分支下运行此脚本。
    pause
    exit /b 1
)

set "PACKAGE_DIR=%~dp0effect-manager-package"
set "ZIP_NAME=effect-manager-update.zip"

echo [1/3] 清理旧打包文件...
if exist "%PACKAGE_DIR%" rmdir /s /q "%PACKAGE_DIR%"
if exist "%ZIP_NAME%" del /q "%ZIP_NAME%"

echo [2/3] 构建前端...
cd /d "%~dp0frontend"
call pnpm run build
if %errorlevel% neq 0 (
    echo [错误] 前端构建失败。
    pause
    exit /b 1
)

cd /d "%~dp0"

echo [3/3] 收集变更文件...

REM === 创建目录结构 ===
mkdir "%PACKAGE_DIR%\dist" 2>nul

REM === 复制前端 dist ===
xcopy /e /i /q "frontend\dist" "%PACKAGE_DIR%\dist"

REM === 复制后端变更文件 ===
for %%f in (
    VERSION
    config\background_manager.py
    config\character_manager.py
    config\config_manager.py
    config\mirror_env.py
    config\schema.py
    core\handlers\ui_message_handler.py
    core\plugins\github_bundle_update.py
    core\plugins\pip_index_config.py
    core\plugins\pip_runner.py
    core\plugins\plugin_requirements_install.py
    core\plugins\registry_catalog.py
    core\plugins\registry_download.py
    core\runtime\app_runtime.py
    core\runtime\ui_update_manager.py
    core\sprite\sprite_cli.py
    frontend_bridge.py
    frontend_bridge_core\backgrounds.py
    frontend_bridge_core\characters.py
    frontend_bridge_core\chat.py
    frontend_bridge_core\config.py
    frontend_bridge_core\effects.py
    frontend_bridge_core\handler.py
    frontend_bridge_core\plugin_catalog.py
    frontend_bridge_core\plugin_publisher.py
    frontend_bridge_core\plugin_updates.py
    frontend_bridge_core\runtime_dependencies.py
    i18n\locales\en.json
    i18n\locales\ja.json
    i18n\locales\zh_CN.json
    llm\constants.py
    llm\llm_manager.py
    llm\template_generator.py
    main.py
    sdk\plugin_host_context.py
    t2i\t2i_adapter.py
    tools\comfyui_workflow2api.py
    tools\file_util.py
) do (
    if exist "%%f" (
        for %%d in ("%%f") do (
            mkdir "%PACKAGE_DIR%\%%~dpd" 2>nul
        )
        copy /y "%%f" "%PACKAGE_DIR%\%%f" >nul 2>&1
    )
)

REM === 复制新增的目录（完整复制） ===
for %%d in (
    core\plugins\publisher
) do (
    if exist "%%d" (
        xcopy /e /i /q "%%d" "%PACKAGE_DIR%\%%d" >nul 2>&1
    )
)

REM === 复制新增的前端文件 ===
for %%f in (
    frontend\src\entities\effect\repository.ts
    frontend\src\features\effect-manager\EffectManagerPage.css
    frontend\src\features\effect-manager\EffectManagerPage.tsx
    frontend\public\onboarding-catgirl-complete.png
) do (
    if exist "%%f" (
        for %%d in ("%%f") do mkdir "%PACKAGE_DIR%\%%~dpd" 2>nul
        copy /y "%%f" "%PACKAGE_DIR%\%%f" >nul 2>&1
    )
)

REM === 打包成 zip ===
echo.
echo 正在打包...
powershell -Command "Compress-Archive -Path '%PACKAGE_DIR%\*' -DestinationPath '%CD%\%ZIP_NAME%' -Force"

if exist "%ZIP_NAME%" (
    rmdir /s /q "%PACKAGE_DIR%"
    echo.
    echo   ============================================
    echo     打包完成！
    echo     %ZIP_NAME%
    echo   ============================================
    echo.
    echo   把 %ZIP_NAME% 发给用户，
    echo   并附上 install-effect-manager.bat 即可。
    echo.
) else (
    echo [错误] 打包失败。
)

pause
