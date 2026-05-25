@echo off
chcp 65001 >nul
echo ====================================
echo     观影记录管理系统
echo ====================================
echo 正在启动服务...
echo.

set NODE_PATH=C:\Program Files\nodejs
set PATH=%NODE_PATH%;%PATH%

start /B "" cmd /c "node server/server.js"

echo 等待服务启动...
timeout /t 5 /nobreak >nul

echo 正在打开浏览器...
start "" "http://localhost:3000"

echo.
echo 应用已启动！
echo   本地访问: http://localhost:3000
echo.
echo   局域网访问: http://192.168.5.31:3000
echo.
echo   请确保防火墙允许端口 3000
echo.
echo 按任意键停止服务...
pause >nul

taskkill /f /im node.exe >nul 2>&1
echo 服务已停止。
