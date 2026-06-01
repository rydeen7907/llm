/**
 * データ管理クラス (Model)
 * 
 * チャットの履歴、設定、カスタムプリセットの管理を担当します。
 * IndexedDB (db.js) と通信し、データの永続化（保存と読み込み）を行います。
 */
import { getAllChats, putChat, deleteChatFromDB, openDB } from './db.js';
import { DEFAULT_SYSTEM_PROMPT } from './constants.js';
export class ChatManager {
    constructor() {
        this.chats = [];
        this.currentChatId = localStorage.getItem('currentChatId');
        this.currentChat = null;
        this.customPresets = JSON.parse(localStorage.getItem('custom_presets') || '{}');
    }

    // 全チャットデータの初期ロード
    async loadAll() {
        this.chats = await getAllChats();
        
        // 初期化ロジック
        if (this.chats.length === 0) {
            await this.createNewChat();
        } else {
            // 互換性チェック: 古いデータにsettingsがない場合は補完する
            this.chats.forEach(c => {
                if (!c.settings) {
                    c.settings = { temperature: 0.7, top_p: 0.9, max_tokens: -1, frequency_penalty: 0.0, presence_penalty: 0.0 };
                }
            });
            this.currentChat = this.chats.find(c => c.id === this.currentChatId) || this.chats[0];
            this.currentChatId = this.currentChat.id;
        }
        return this.currentChat;
    }

    // 新規チャットの作成と初期設定
    async createNewChat(systemPrompt = DEFAULT_SYSTEM_PROMPT) {
        const id = Date.now().toString();
        const newChat = {
            id, 
            name: '新しいチャット', 
            history: [], 
            systemPrompt: systemPrompt,
            settings: { temperature: 0.7, top_p: 0.9, max_tokens: -1, frequency_penalty: 0.0, presence_penalty: 0.0 }
        };
        this.chats.unshift(newChat);
        await putChat(newChat);
        this.currentChatId = id;
        this.currentChat = newChat;
        localStorage.setItem('currentChatId', id);
        return newChat;
    }

    // チャットの切り替え
    async switchChat(id) {
        const chat = this.chats.find(c => c.id === id);
        if (!chat) return null;
        this.currentChatId = id;
        this.currentChat = chat;
        localStorage.setItem('currentChatId', id);
        await this.saveCurrent();
        return chat;
    }

    // チャットの削除
    async deleteChat(id) {
        this.chats = this.chats.filter(c => c.id !== id);
        await deleteChatFromDB(id);
        if (this.chats.length === 0) {
            return await this.createNewChat();
        } else if (this.currentChatId === id) {
            return await this.switchChat(this.chats[0].id);
        }
        return this.currentChat;
    }

    // 現在のチャットの状態をDBに保存
    async saveCurrent() {
        if (this.currentChat) {
            await putChat(this.currentChat);
        }
    }

    /**
     * 指定したチャットをデータベースに保存する
     */
    async saveChat(chat) {
        if (chat) await putChat(chat);
    }

    // 履歴にメッセージを追加
    addHistory(role, content, icon) {
        if (this.currentChat) {
            this.currentChat.history.push({ role, content, icon });
        }
    }

    // 簡易的なタイトルの更新（AI生成前の一時的なもの）
    updateTitle(text) {
        this.currentChat.name = text.substring(0, 20) + (text.length > 20 ? '...' : '');
    }

    // システムプロンプトをカスタムテンプレートとして保存
    saveCurrentSystemPromptAsTemplate(name) {
        if (!this.currentChat || !name) return;
        this.customPresets[name] = this.currentChat.systemPrompt;
        localStorage.setItem('custom_presets', JSON.stringify(this.customPresets));
        return this.customPresets;
    }

    deleteCustomPreset(name) {
        delete this.customPresets[name];
        localStorage.setItem('custom_presets', JSON.stringify(this.customPresets));
        return this.customPresets;
    }

    async updateSystemPrompt(prompt) {
        this.currentChat.systemPrompt = prompt;
        await this.saveCurrent();
    }

    /**
     * 現在のチャット以外の画像データを削除して容量を確保する
     */
    async cleanupOldImages() {
        const beforeSize = JSON.stringify(this.chats).length;
        let imageCount = 0;
        const affectedChats = [];

        for (const chat of this.chats) {
            // 現在表示中のチャットは保護する
            if (chat.id === this.currentChatId) continue;
            
            let chatModified = false;
            chat.history.forEach(msg => {
                if (Array.isArray(msg.content)) {
                    const initialLen = msg.content.length;
                    msg.content = msg.content.filter(part => part.type !== 'image_url');
                    const removed = initialLen - msg.content.length;
                    if (removed > 0) {
                        imageCount += removed;
                        msg.content.push({ type: 'text', text: `\n[画像(${removed}枚)削除済み]` });
                        chatModified = true;
                    }
                }
            });
            if (chatModified) affectedChats.push(chat);
        }

        for (const chat of affectedChats) await putChat(chat);

        const afterSize = JSON.stringify(this.chats).length;
        return { imageCount, clearedBytes: Math.max(0, beforeSize - afterSize) };
    }

    /**
     * アプリ全体のデータをエクスポート用にパッケージ化する
     */
    async getFullBackupData() {
        const settings = {};
        const keys = [
            'global_theme_color', 'global_wallpaper', 'global_wallpaper_opacity',
            'global_wallpaper_blur', 'global_wallpaper_fit', 'global_toast_duration',
            'custom_presets', 'currentChatId'
        ];
        keys.forEach(k => {
            const val = localStorage.getItem(k);
            if (val !== null) settings[k] = val;
        });

        return {
            version: 1,
            timestamp: new Date().toISOString(),
            chats: this.chats,
            settings: settings
        };
    }

    /**
     * バックアップデータから復元する
     */
    async restoreFullBackup(data) {
        if (!data.chats || !data.settings) throw new Error('データが不完全です');

        // 1. LocalStorageの復元
        Object.entries(data.settings).forEach(([k, v]) => localStorage.setItem(k, v));

        // 2. IndexedDBの復元 (既存データをクリアしてから追加)
        const db = await openDB();
        const tx = db.transaction('chats', 'readwrite');
        const store = tx.objectStore('chats');
        await store.clear();
        for (const chat of data.chats) {
            await store.put(chat);
        }
        return true;
    }
}