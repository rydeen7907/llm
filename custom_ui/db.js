/**
 * ブラウザ内データベース (IndexedDB) 管理モジュール
 * 
 * localStorage よりも大きなデータ（チャット履歴や画像）を保存するために使用します。
 * このファイルでは、DBの接続、保存、読み込み、削除の低レイヤーな処理を提供します。
 */

const DB_NAME = 'LlmChatDB';
const STORE_NAME = 'chats';
const DB_VERSION = 1;

/**
 * データベースを開く
 */
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

export { openDB };

/**
 * 全てのチャットを取得する
 */
export async function getAllChats() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * チャットを保存または更新する
 */
export async function putChat(chat) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(chat);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * チャットを削除する
 */
export async function deleteChatFromDB(id) {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    await store.delete(id);
}