/**
 * ネットワーク通信モジュール (Infrastructure)
 * 
 * バックエンドの llama-server (または sidecar_api) との通信を担当します。
 * fetch API を使用して、推論リクエストやサーバー状態の取得を行います。
 */
const API_BASE = 'http://127.0.0.1:8080';

const parseNum = (val, def) => {
    const n = parseFloat(val);
    return isNaN(n) ? def : n;
};

export async function sendChatRequest(messages, signal, settings = {}) {
    const response = await fetch(`${API_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages: messages,
            stream: false,
            temperature: parseNum(settings.temperature, 0.7),
            top_p: parseNum(settings.top_p, 0.9),
            max_tokens: parseNum(settings.max_tokens, -1),
            frequency_penalty: parseNum(settings.frequency_penalty, 0.0),
            presence_penalty: parseNum(settings.presence_penalty, 0.0)
        }),
        signal: signal
    });
    if (!response.ok) throw new Error('サーバーエラーが発生しました');
    return await response.json();
}

/**
 * 使用可能なモデル情報を取得する
 */
export async function getModels() {
    const response = await fetch(`${API_BASE}/v1/models`);
    if (!response.ok) throw new Error('モデル情報の取得に失敗しました');
    return await response.json();
}

/**
 * サーバーの健康状態（ロード状況）を取得する
 */
export async function getHealth() {
    const response = await fetch(`${API_BASE}/health`);
    if (!response.ok) return { status: 'loading' };
    return await response.json();
}

/**
 * サーバーのプロパティ（コンテキストサイズなど）を取得する
 */
export async function getProps() {
    const response = await fetch(`${API_BASE}/props`);
    if (!response.ok) return null;
    return await response.json();
}