cd /d %~dp0
timeout /t 1 >nul

start http://127.0.0.1:8080
llama-server.exe -m models/model_name.gguf --port 8080
pause



rem このコードで起動させる場合、10行目からのコメントは必ず削除してください。
rem このファイルはサンプルで、かつ流用可能です。(ファイル名のモデルは実際にあります。)
rem モデル名を書き換えるだけで、ブラウザが自動で起動します。(ファイル名も任意で変えてもOK)
rem この場合、GUIはLlama.cppオリジナルで英語表記です。
