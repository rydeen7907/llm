/**
 * バックアップ・セキュリティモジュール
 * 
 * データの書き出し（ダウンロード）や読み込み、
 * Web Crypto API を利用した AES-GCM 方式によるデータの暗号化・復号を担当します。
 */

/**
 * オブジェクトをJSONファイルとしてダウンロードさせる
 */
export function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * 選択されたファイルをテキストとして読み込む
 */
export function readJSONFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const json = JSON.parse(e.target.result);
                resolve(json);
            } catch (err) {
                reject(new Error('ファイルの形式が正しくありません。'));
            }
        };
        reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました。'));
        reader.readAsText(file);
    });
}

/**
 * パスワードから暗号化キーを誘導する (PBKDF2)
 */
async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false, ["encrypt", "decrypt"]
    );
}

/**
 * データをパスワードで暗号化する
 */
export async function encryptData(data, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const enc = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        enc.encode(JSON.stringify(data))
    );

    return {
        salt: btoa(Array.from(salt, x => String.fromCharCode(x)).join('')),
        iv: btoa(Array.from(iv, x => String.fromCharCode(x)).join('')),
        ciphertext: btoa(Array.from(new Uint8Array(ciphertext), x => String.fromCharCode(x)).join('')),
        encrypted: true
    };
}

/**
 * 暗号化されたデータを復号する
 */
export async function decryptData(pkg, password) {
    const salt = new Uint8Array(atob(pkg.salt).split("").map(c => c.charCodeAt(0)));
    const iv = new Uint8Array(atob(pkg.iv).split("").map(c => c.charCodeAt(0)));
    const ciphertext = new Uint8Array(atob(pkg.ciphertext).split("").map(c => c.charCodeAt(0)));
    const key = await deriveKey(password, salt);
    
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(decrypted));
}