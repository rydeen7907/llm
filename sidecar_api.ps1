$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:5001/")
try {
    $listener.Start()
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        # CORS設定（ブラウザからのリクエストを許可）
        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "POST, OPTIONS")

        if ($request.HttpMethod -eq "POST" -and $request.Url.AbsolutePath -eq "/shutdown") {
            # llama-serverプロセスを強制終了
            Get-Process "llama-server" -ErrorAction SilentlyContinue | Stop-Process -Force
            $response.Close()
            break # スクリプトを終了
        }
        $response.Close()
    }
} finally {
    $listener.Stop()
}