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
echo  [1] Gemma3 1B
echo  [2] Gemma4 mmproj BF16
echo  [3] Hy-MT2 1.8B (翻訳向)
echo  [4] Qwen3.5 0.8B
echo  [5] Qwen2.5 coder 1.5B
echo  [6] LFM2.5 1.2B (日本語特化)
echo  [7] Llama3.2 1B
echo  [8] Bonsai 1.7B
echo  [9] Bonsai 8B
echo  [Q] 終了する
echo.
echo ==================================================
set MODEL=
set /p choice="使用するモデルの番号を選択してください: "

if /i "%choice%"=="Q" exit /b
if "%choice%"=="1" set MODEL=gemma-3-1b-it-Q5_K_M.gguf
if "%choice%"=="2" set MODEL=mmproj-BF.16.gguf
if "%choice%"=="3" set MODEL=Hy-Mt2-1.8B-Q4_K_m.gguf
if "%choice%"=="4" set MODEL=Qwen3.5-0.8B-Q6_K.gguf
if "%choice%"=="5" set MODEL=Qwen2.5-coder-1.5b-instruct-q5_k_m.gguf
if "%choice%"=="6" set MODEL=LFM2.5-1.2B-JP-Q5_K_M.gguf
if "%choice%"=="7" set MODEL=Llama-3.2-1B-instruct-Q6_K.gguf
if "%choice%"=="8" set MODEL=Bonsai-1.7B-Q1_0.gguf
if "%choice%"=="9" set MODEL=Bonsai-8B-Q1_0.gguf

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
