cd /d %~dp0
timeout /t 1 >nul

start http://127.0.0.1:8080
llama-server.exe -m models/Bonsai-1.7B-Q1_0.gguf --port 8080
pause

