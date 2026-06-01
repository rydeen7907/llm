@echo off
chcp 65001 >nul
cd /d %~dp0

rem UIファイルを格納する専用フォルダ名
set UI_DIR=custom_ui
if not exist "%UI_DIR%" mkdir "%UI_DIR%"

:MENU
cls
echo ==================================================
echo      ローカルLLMサーバー 起動メニュー
echo ==================================================
echo.
echo  [1] model_name
echo  [2] 
echo  [3] 
echo  [4] 
echo  [5] 
echo  [6] 
echo  [7] 
echo  [8] 
echo  [9] 
echo  [Q] 終了する
echo.
echo ==================================================
set MODEL=
set /p choice="使用するモデルの番号を選択してください: "

if /i "%choice%"=="Q" exit /b
if "%choice%"=="1" set MODEL=model_name.gguf
if "%choice%"=="2" set MODEL=
if "%choice%"=="3" set MODEL=
if "%choice%"=="4" set MODEL=
if "%choice%"=="5" set MODEL=
if "%choice%"=="6" set MODEL=
if "%choice%"=="7" set MODEL=
if "%choice%"=="8" set MODEL=
if "%choice%"=="9" set MODEL=

if not defined MODEL (
    echo.
    echo [!] 無効な選択です。1から9の数字、または Q を入力してください。
    timeout /t 2 >nul
    goto MENU
)

echo.
echo 選択されたモデル: %MODEL%
echo サーバーを起動し、読み込み画面（http://127.0.0.1:8080/loading.html）を開きます...
start /b "" powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File sidecar_api.ps1
start http://127.0.0.1:8080/loading.html
llama-server.exe -m models/%MODEL% --port 8080 --path %UI_DIR%







rem ここから先はコメントです、実際に使用する際は必ず削除してください。
rem このファイルのGUIは、custom_uiフォルダのファイルを使用した日本語化GUIです。
rem GUIもカスタマイズして使うのもアリです。






