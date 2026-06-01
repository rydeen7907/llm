/**
 * UI管理クラス (View Controller)
 * 
 * DOM要素の参照を保持し、画面の更新、入力フォームの同期、
 * 壁紙やテーマカラーの適用といった「見た目」に関する制御を一手に引き受けます。
 */
import { addMessage, renderPreviews, renderChatList } from './ui.js';
import { MAX_SYSTEM_PROMPT_LENGTH, MAX_USER_INPUT_LENGTH } from './constants.js';

export class UIManager {
    constructor() {
        // HTML上の全ての操作対象要素を this.el にキャッシュ
        this.el = {
            chatContainer: document.getElementById('chat-container'),
            userInput: document.getElementById('user-input'),
            sendBtn: document.getElementById('send-btn'),
            attachBtn: document.getElementById('attach-btn'),
            filePreview: document.getElementById('file-preview'),
            fileInput: document.getElementById('file-input'),
            systemInput: document.getElementById('system-input'),
            chatListContainer: document.getElementById('chat-list'),
            newChatBtn: document.getElementById('new-chat-btn'),
            settingsBtn: document.getElementById('settings-btn'),
            settingsModal: document.getElementById('settings-modal'),
            cleanupFilesBtn: document.getElementById('cleanup-files-btn'),
            resetSettingsBtn: document.getElementById('reset-settings-btn'),
            closeSettingsBtn: document.getElementById('close-settings-btn'),
            serverStopBtn: document.getElementById('server-stop-btn'),
            exportBtn: document.getElementById('export-btn'),
            importBtn: document.getElementById('import-btn'),
            importFile: document.getElementById('import-file'),
            presetSelect: document.getElementById('preset-select'),
            customPresetName: document.getElementById('custom-preset-name'),
            savePresetBtn: document.getElementById('save-preset-btn'),
            systemPromptCounter: document.getElementById('system-prompt-counter'),
            modelDisplay: document.getElementById('model-display'),
            statusIndicator: document.getElementById('status-indicator'),
            resourceDisplay: document.getElementById('resource-display'),
            storageBar: document.getElementById('storage-bar'),
            storagePercent: document.getElementById('storage-percent'),
            mainChat: document.getElementById('main-chat'),
            inputWallpaper: document.getElementById('input-wallpaper'),
            resetWallpaperBtn: document.getElementById('reset-wallpaper-btn'),
            inputWallpaperUrl: document.getElementById('input-wallpaper-url'),
            inputWallpaperOpacity: document.getElementById('input-wallpaper-opacity'),
            valWallpaperOpacity: document.getElementById('val-wallpaper-opacity'),
            inputWallpaperBlur: document.getElementById('input-wallpaper-blur'),
            valWallpaperBlur: document.getElementById('val-wallpaper-blur'),
            inputWallpaperFit: document.getElementById('input-wallpaper-fit'),
            inputThemeColor: document.getElementById('input-theme-color'),
            inputToastDuration: document.getElementById('input-toast-duration'),
            valToastDuration: document.getElementById('val-toast-duration'),
            inputTemp: document.getElementById('input-temp'),
            inputTopP: document.getElementById('input-top-p'),
            inputMaxTokens: document.getElementById('input-max-tokens'),
            inputFrequency: document.getElementById('input-frequency'),
            inputPresence: document.getElementById('input-presence'),
            valTemp: document.getElementById('val-temp'),
            valTopP: document.getElementById('val-top-p'),
            valFrequency: document.getElementById('val-frequency'),
            valPresence: document.getElementById('val-presence'),
            clearBtn: document.getElementById('clear-btn'),
            userInputCounter: document.getElementById('user-input-counter'),
            shortenBtn: document.getElementById('shorten-suggestion-btn'),
        };
        this.onContinueHandler = null;
    }

    setContinueHandler(handler) {
        this.onContinueHandler = handler;
    }

    // チャット履歴全体を画面に再描画
    renderChat(chat, chats) {
        this.el.chatContainer.innerHTML = '';
        
        // パラメーター設定の反映
        this.updateSetting('system_prompt', chat.systemPrompt || '');
        const s = chat.settings || { temperature: 0.7, top_p: 0.9, max_tokens: -1, frequency_penalty: 0.0, presence_penalty: 0.0 };
        this.updateSetting('temperature', s.temperature);
        this.updateSetting('top_p', s.top_p);
        this.updateSetting('max_tokens', s.max_tokens);
        this.updateSetting('frequency_penalty', s.frequency_penalty ?? 0.0);
        this.updateSetting('presence_penalty', s.presence_penalty ?? 0.0);
        
        chat.history.forEach(msg => {
            const isUser = msg.role === 'user';
            let text = '', images = [];
            if (typeof msg.content === 'string') {
                text = msg.content;
            } else if (Array.isArray(msg.content)) {
                msg.content.forEach(p => {
                    if (p.type === 'text') text += p.text;
                    if (p.type === 'image_url') images.push(p.image_url.url);
                });
            }
            const icon = isUser ? '👤' : (msg.icon || '🤖');
            
            const metadata = msg.metadata ? { ...msg.metadata } : null;
            if (metadata && metadata.isOverLimit) {
                metadata.onContinue = () => this.onContinueHandler();
            }

            addMessage(this.el.chatContainer, { text, isUser, icon, images, metadata });
        });
        
        renderChatList(this.el.chatListContainer, chats, chat.id);
    }

    /**
     * プリセットドロップダウンを更新する
     */
    renderPresets(systemPresets, customPresets, presetLabels) {
        const select = this.el.presetSelect;
        const currentValue = select.value;
        
        let html = '<option value="">-- プリセットを選択 --</option>';
        
        // 標準プリセット
        for (const key in systemPresets) {
            html += `<option value="${key}">${presetLabels[key] || key}</option>`;
        }
        
        // カスタムプリセット
        for (const name in customPresets) {
            html += `<option value="custom:${name}">★ ${name}</option>`;
        }
        
        select.innerHTML = html;
        select.value = currentValue;
    }

    /**
     * 設定値に基づいてUI要素（入力値、ラベル、視覚効果）を同期更新する
     */
    updateSetting(key, value) {
        const mapping = {
            'system_prompt': { input: 'systemInput', sideEffect: (v) => this.updateSystemPromptCounter(v) },
            'temperature': { input: 'inputTemp', label: 'valTemp' },
            'top_p': { input: 'inputTopP', label: 'valTopP' },
            'frequency_penalty': { input: 'inputFrequency', label: 'valFrequency' },
            'presence_penalty': { input: 'inputPresence', label: 'valPresence' },
            'max_tokens': { input: 'inputMaxTokens' },
            'wallpaper_opacity': { input: 'inputWallpaperOpacity', label: 'valWallpaperOpacity', sideEffect: (v) => this.applyWallpaperOpacity(v) },
            'wallpaper_blur': { input: 'inputWallpaperBlur', label: 'valWallpaperBlur', sideEffect: (v) => this.applyWallpaperBlur(v) },
            'wallpaper_fit': { input: 'inputWallpaperFit', sideEffect: (v) => this.applyWallpaperFit(v) },
            'theme_color': { input: 'inputThemeColor', sideEffect: (v) => this.applyThemeColor(v) },
            'toast_duration': { input: 'inputToastDuration', label: 'valToastDuration' }
        };

        const config = mapping[key];
        if (!config) return;

        // 入力フォームの値更新
        if (config.input && this.el[config.input] && this.el[config.input].value != value) {
            this.el[config.input].value = value;
        }
        // 数値表示ラベルの更新
        if (config.label && this.el[config.label]) {
            this.el[config.label].textContent = value;
        }
        // 視覚的サイドエフェクト（壁紙適用など）の実行
        if (config.sideEffect) {
            config.sideEffect(value);
        }
    }

    /**
     * システムプロンプトの文字数カウンターを更新する
     */
    updateSystemPromptCounter(text) {
        if (!this.el.systemPromptCounter) return;
        const len = text.length;
        this.el.systemPromptCounter.textContent = `${len} / ${MAX_SYSTEM_PROMPT_LENGTH}`;
        
        // 上限超えの視覚的警告
        this.el.systemPromptCounter.style.color = len > MAX_SYSTEM_PROMPT_LENGTH ? '#ff4d4d' : '#65676b';
    }

    /**
     * ユーザー入力の文字数・トークン数カウンターを更新する
     */
    updateUserInputCounter(text, tokenLimit = null) {
        if (!this.el.userInputCounter) return;
        const len = text.length;
        const estTokens = Math.ceil(len * 1.1); // 簡易推定 (1文字≒1.1トークン)

        // 指定されたトークン制限を文字数目安に変換 (トークン / 1.1) 
        // 指定がない場合は定数の 4000 を使用
        const charLimit = (tokenLimit && tokenLimit > 0) 
            ? Math.floor(tokenLimit / 1.1) 
            : MAX_USER_INPUT_LENGTH;

        this.el.userInputCounter.textContent = `${len} 文字 (推定 ${estTokens} トークン) / ${charLimit}`;

        const isOverLimit = len > charLimit;

        // リミット超えの時だけ「短縮依頼」ボタンを表示
        if (this.el.shortenBtn) this.el.shortenBtn.style.display = isOverLimit ? 'inline' : 'none';

        if (isOverLimit) {
            this.el.userInputCounter.style.color = '#ff4d4d';
            this.el.userInputCounter.textContent += ' 【上限を超えています】';
        } else if (len > charLimit * 0.9) {
            this.el.userInputCounter.style.color = '#ff4d4d';
            this.el.userInputCounter.textContent += ' 【上限が近いです】';
        } else {
            this.el.userInputCounter.style.color = '#65676b';
        }

        // 「送信」モードの時のみ、文字数過多でボタンを無効化する
        // 「停止」モード（生成中）の時は、中断を許可するため無効化しない
        if (this.el.sendBtn && this.el.sendBtn.textContent === '送信') {
            this.el.sendBtn.disabled = isOverLimit || (this.el.userInput.disabled && this.el.sendBtn.textContent === '送信');
        }
    }

    /**
     * 設定画面の各入力要素にリアクティブなイベントリスナーを登録する
     * @param {Function} onUpdate - 値が変更された際に呼ばれるコールバック (key, value) => void
     */
    initSettingsReactivity(onUpdate) {
        const reactiveConfigs = [
            { id: 'system_prompt', el: 'systemInput' },
            { id: 'temperature', el: 'inputTemp' },
            { id: 'top_p', el: 'inputTopP' },
            { id: 'frequency_penalty', el: 'inputFrequency' },
            { id: 'presence_penalty', el: 'inputPresence' },
            { id: 'max_tokens', el: 'inputMaxTokens', type: 'change' },
            { id: 'wallpaper_opacity', el: 'inputWallpaperOpacity' },
            { id: 'wallpaper_blur', el: 'inputWallpaperBlur' },
            { id: 'toast_duration', el: 'inputToastDuration' },
            { id: 'theme_color', el: 'inputThemeColor' },
            { id: 'wallpaper_fit', el: 'inputWallpaperFit', type: 'change' }
        ];

        reactiveConfigs.forEach(cfg => {
            const target = this.el[cfg.el];
            if (!target) return;

            target.addEventListener(cfg.type || 'input', (e) => {
                const val = e.target.value;
                this.updateSetting(cfg.id, val);
                if (onUpdate) onUpdate(cfg.id, val);
            });
        });
    }

    // 生成中などにボタンや入力を無効化/有効化する
    setUIState(enabled) {
        if (this.el.userInput) this.el.userInput.disabled = !enabled;
        if (this.el.sendBtn) {
            this.el.sendBtn.textContent = enabled ? '送信' : '停止';
            this.el.sendBtn.classList.toggle('stop-mode', !enabled);
            
            if (enabled) {
                // 生成終了時：現在の入力内容に基づいてボタンの状態を再判定
                // ※実際のリミット値は script.js 側から制御されるため、ここでは簡易呼び出し
                this.el.userInput.dispatchEvent(new Event('input'));
            } else {
                // 生成開始時：中断ボタンとして機能させるため一時的に有効化
                this.el.sendBtn.disabled = false;
            }
        }
        
        const controlKeys = [
            'attachBtn', 'settingsBtn', 'cleanupFilesBtn', 'resetSettingsBtn', 
            'inputTemp', 'inputTopP', 'inputMaxTokens', 'systemInput', 
            'customPresetName', 'savePresetBtn', 'serverStopBtn', 'exportBtn', 'importBtn',
            'inputThemeColor', 'inputToastDuration', 'inputFrequency', 
            'inputPresence', 'presetSelect'
        ];
        controlKeys.forEach(k => {
            if (this.el[k]) this.el[k].disabled = !enabled;
        });
    }

    // ストレージ使用量のインジケーター更新
    updateStorageMeter(chats, storageLimit) {
        const used = JSON.stringify(chats).length + JSON.stringify(localStorage).length;
        const percent = Math.min((used / (storageLimit * 20)) * 100, 100);
        this.el.storageBar.style.width = percent + '%';
        this.el.storagePercent.textContent = percent.toFixed(1) + '%';
    }

    // 背景壁紙のスタイル適用
    applyWallpaper(url) {
        if (!this.el.mainChat) return;
        if (url) this.el.mainChat.style.setProperty('--chat-wallpaper', `url('${url}')`);
        else this.el.mainChat.style.removeProperty('--chat-wallpaper');
    }

    applyWallpaperOpacity(v) {
        if (this.el.mainChat) this.el.mainChat.style.setProperty('--chat-wallpaper-opacity', v);
        if (this.el.valWallpaperOpacity) this.el.valWallpaperOpacity.textContent = v;
    }

    applyWallpaperBlur(v) {
        if (this.el.mainChat) this.el.mainChat.style.setProperty('--chat-wallpaper-blur', `${v}px`);
        if (this.el.valWallpaperBlur) this.el.valWallpaperBlur.textContent = v;
    }

    applyWallpaperFit(fit) {
        if (!this.el.mainChat) return;
        const isTile = fit === 'tile';
        this.el.mainChat.style.setProperty('--chat-wallpaper-size', isTile ? 'auto' : fit);
        this.el.mainChat.style.setProperty('--chat-wallpaper-repeat', isTile ? 'repeat' : 'no-repeat');
    }

    applyThemeColor(color) {
        document.documentElement.style.setProperty('--primary-color', color);
    }
}