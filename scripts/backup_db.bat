@echo off
REM VeraRoute - Backup automatizado de la BD gestorrutas
REM Uso: scripts\backup_db.bat
REM Programar con Task Scheduler de Windows para ejecucion diaria

set MYSQL_BIN=c:\wamp64\bin\mysql\mysql8.4.7\bin
set DB_HOST=127.0.0.1
set DB_PORT=3308
set DB_USER=root
set DB_NAME=gestorrutas
set BACKUP_DIR=c:\wamp64\www\Gestor de Rutas\backups

REM Crear directorio de backups si no existe
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

REM Generar nombre con fecha
for /f "tokens=1-3 delims=-" %%a in ('%MYSQL_BIN%\mysql.exe -h %DB_HOST% -P %DB_PORT% -u %DB_USER% -N -e "SELECT CURDATE()" %DB_NAME%') do set FECHA=%%a-%%b-%%c
if "%FECHA%"=="" set FECHA=%date:~6,4%-%date:~3,2%-%date:~0,2%

set BACKUP_FILE=%BACKUP_DIR%\%DB_NAME%_%FECHA%.sql

REM Ejecutar mysqldump
"%MYSQL_BIN%\mysqldump.exe" -h %DB_HOST% -P %DB_PORT% -u %DB_USER% --single-transaction --routines --triggers %DB_NAME% > "%BACKUP_FILE%"

if %ERRORLEVEL% EQU 0 (
    echo [OK] Backup creado: %BACKUP_FILE%
    REM Eliminar backups de mas de 30 dias
    forfiles /p "%BACKUP_DIR%" /s /m *.sql /d -30 /c "cmd /c del @path" 2>nul
    echo [OK] Backups antiguos limpiados
) else (
    echo [ERROR] Fallo al crear backup
    exit /b 1
)
