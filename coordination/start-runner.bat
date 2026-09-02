@echo off
cd /d "%~dp0.."
echo Iniciando runner autonomo (poll 5s)...
node coordination\runner.mjs 5
