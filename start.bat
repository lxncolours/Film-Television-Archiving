@echo off
set NODE_ENV=production
set PYTHONIOENCODING=UTF-8
set LANG=zh_CN.UTF-8
chcp 65001 > nul
node server/server.js